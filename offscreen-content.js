// offscreen-content.js - Script to run inside the offscreen document for silent extraction
let extractionAttempted = false
let retryCount = 0
const MAX_RETRIES = 3
const EXTRACTION_TIMEOUT = 30000 // 30 seconds
const RETRY_DELAY = 3000 // 3 seconds between retries

console.log("Bloomix Extractor: Offscreen content script loaded.")

// Updated selectors based on the actual LinkedIn HTML structure
function findProfileContainer() {
  const selectors = [
    "main.GniorShHVuXCMkZngwVQmRrvjcItTudLr",
    'main[class*="GniorShHVuXCMkZngwVQmRrvjcItTudLr"]',
    'main[class*="scaffold-layout"]',
    'main[role="main"]',
    ".scaffold-layout__main",
    ".application-outlet main",
    "#main-content",
    "main",
  ]
  for (const selector of selectors) {
    const container = document.querySelector(selector)
    if (container && container.innerHTML.length > 1000) {
      console.log(`Bloomix Extractor (Offscreen): Found profile container with selector: ${selector}`)
      console.log(`Container content length: ${container.innerHTML.length} characters`)
      return container
    }
  }
  console.warn("Bloomix Extractor (Offscreen): Could not find profile container with any known selector")
  return null
}

// Enhanced profile content detection based on actual LinkedIn structure
function hasProfileContent() {
  const indicators = [
    "h1.jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg",
    'h1[class*="jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg"]',
    ".pv-text-details__left-panel h1",
    'h1[class*="inline"][class*="t-24"]',
  ]
  let foundIndicators = 0
  for (const selector of indicators) {
    const element = document.querySelector(selector)
    if (element && element.textContent.trim().length > 0) {
      console.log(`Found profile indicator (Offscreen): ${selector} = "${element.textContent.trim().substring(0, 50)}..."`)
      foundIndicators++
    }
  }
  console.log(`Profile content check (Offscreen): Found ${foundIndicators} indicators`)
  return foundIndicators >= 2 // Need at least 2 indicators to confirm it's a profile
}

// Extract specific profile information for validation
function getProfileInfo() {
  const info = {}
  const nameSelectors = [
    "h1.jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg",
    'h1[class*="jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg"]',
    ".pv-text-details__left-panel h1",
    'h1[class*="inline"][class*="t-24"]',
  ]
  for (const selector of nameSelectors) {
    const nameEl = document.querySelector(selector)
    if (nameEl && nameEl.textContent.trim()) {
      info.name = nameEl.textContent.trim()
      break
    }
  }
  const headlineSelectors = [
    ".text-body-medium.break-words[data-generated-suggestion-target]",
    ".pv-text-details__left-panel .text-body-medium",
    '[class*="text-body-medium"][class*="break-words"]',
  ]
  for (const selector of headlineSelectors) {
    const headlineEl = document.querySelector(selector)
    if (headlineEl && headlineEl.textContent.trim()) {
      info.headline = headlineEl.textContent.trim()
      break
    }
  }
  const locationSelectors = [
    ".text-body-small.inline.t-black--light.break-words",
    ".DIZrAHyWEgBLiCHkVNxDohPKnieYlphHkcpQ .text-body-small",
    '[class*="text-body-small"][class*="t-black--light"]',
  ]
  for (const selector of locationSelectors) {
    const locationEl = document.querySelector(selector)
    if (
      locationEl &&
      locationEl.textContent.trim() &&
      !locationEl.textContent.includes("followers") &&
      !locationEl.textContent.includes("connections")
    ) {
      info.location = locationEl.textContent.trim()
      break
    }
  }
  return info
}

// Modified to accept searchId
async function performExtraction(url, searchId) {
  if (extractionAttempted) {
    console.log("Bloomix Extractor (Offscreen): Extraction already attempted, skipping")
    return
  }
  extractionAttempted = true
  console.log(`Bloomix Extractor (Offscreen): Starting extraction attempt ${retryCount + 1}/${MAX_RETRIES} for ${url} (Search ID: ${searchId})`)
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait for content to load

    if (!hasProfileContent()) {
      throw new Error("Profile content not detected on page")
    }

    const profileInfo = getProfileInfo()
    console.log("Profile info detected (Offscreen):", profileInfo)
    if (!profileInfo.name) {
      throw new Error("Could not find profile name - page may not be fully loaded")
    }

    const profileContainer = findProfileContainer()
    if (!profileContainer) {
      throw new Error("Could not find profile container element")
    }

    let domContent = profileContainer.innerHTML
    if (!domContent || domContent.length < 1000) {
      domContent = document.body.innerHTML
      console.log("Using document.body as fallback for content extraction (Offscreen)")
    }
    if (!domContent || domContent.length < 500) {
      throw new Error(`Extracted DOM content is too short (${domContent.length} chars)`)
    }

    const cleanContent = domContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/[\s\S]*?/g, "")
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")

    console.log(`Bloomix Extractor (Offscreen): Extraction successful for ${url}!`)
    console.log(`Profile: ${profileInfo.name}`)
    console.log(`Content length: ${cleanContent.length} chars`)

    // FIXED: Use profileUrl to match backend expectation
    chrome.runtime.sendMessage({
      action: "extractionCompleteOffscreen",
      success: true,
      domContent: cleanContent,
      error: null,
      profileUrl: url, // FIXED: Use profileUrl instead of url
      searchId: searchId,
      extractionMethod: "offscreen-v1",
      contentLength: cleanContent.length,
      profileInfo: profileInfo,
    })
  } catch (error) {
    console.error(`Bloomix Extractor (Offscreen): Extraction attempt ${retryCount + 1} failed for ${url}:`, error)
    retryCount++
    if (retryCount < MAX_RETRIES) {
      console.log(`Bloomix Extractor (Offscreen): Retrying in ${RETRY_DELAY}ms...`)
      extractionAttempted = false // Reset for retry
      setTimeout(() => performExtraction(url, searchId), RETRY_DELAY)
      return
    }

    // FIXED: Use profileUrl to match backend expectation
    chrome.runtime.sendMessage({
      action: "extractionCompleteOffscreen",
      success: false,
      domContent: null,
      error: `Extraction failed after ${MAX_RETRIES} attempts: ${error.message}`,
      profileUrl: url, // FIXED: Use profileUrl instead of url
      searchId: searchId,
      extractionMethod: "offscreen-v1",
      retryCount: retryCount,
    })
  }
}

function isLinkedInProfilePage(url) {
  const isProfile = url.includes("linkedin.com/in/") && !url.includes("/edit/") && !url.includes("/overlay/")
  console.log(`URL validation (Offscreen): ${url} -> isProfile: ${isProfile}`)
  return isProfile
}

function waitForProfileContent() {
  return new Promise((resolve, reject) => {
    let checkCount = 0
    const maxChecks = 60 // 60 seconds total
    const checkInterval = setInterval(() => {
      checkCount++
      console.log(`Bloomix Extractor (Offscreen): Content check ${checkCount}/${maxChecks}`)
      if (hasProfileContent()) {
        clearInterval(checkInterval)
        console.log("Bloomix Extractor (Offscreen): Profile content detected!")
        const profileInfo = getProfileInfo()
        console.log("Detected profile info (Offscreen):", profileInfo)
        resolve()
        return
      }
      if (checkCount >= maxChecks) {
        clearInterval(checkInterval)
        reject(new Error("Timeout waiting for profile content to load"))
      }
    }, 1000)
  })
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "loadUrlAndExtract") {
    const { url, searchId } = message
    console.log(`Offscreen: Received request to load and extract: ${url} for search ${searchId}`)
    extractionAttempted = false // Reset for new URL
    retryCount = 0

    if (!isLinkedInProfilePage(url)) {
      console.log("Offscreen: Not a LinkedIn profile page, skipping extraction.")
      // FIXED: Use profileUrl to match backend expectation
      chrome.runtime.sendMessage({
        action: "extractionCompleteOffscreen",
        success: false,
        domContent: null,
        error: "Not a LinkedIn profile page",
        profileUrl: url, // FIXED: Use profileUrl instead of url
        searchId: searchId,
        extractionMethod: "offscreen-v1",
      })
      sendResponse({ success: false, error: "Not a LinkedIn profile page" })
      return true
    }

    try {
      // Navigate the offscreen document
      window.location.href = url
      // Wait for the page to load and content to appear
      await waitForProfileContent()
      // Give it a little more time for rendering
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await performExtraction(url, searchId)
      sendResponse({ success: true })
    } catch (error) {
      console.error("Offscreen: Error during loadUrlAndExtract:", error)
      // FIXED: Use profileUrl to match backend expectation
      chrome.runtime.sendMessage({
        action: "extractionCompleteOffscreen",
        success: false,
        domContent: null,
        error: `Offscreen extraction failed: ${error.message}`,
        profileUrl: url, // FIXED: Use profileUrl instead of url
        searchId: searchId,
        extractionMethod: "offscreen-v1",
      })
      sendResponse({ success: false, error: error.message })
    }
    return true // Keep port open for async response
  }
});
// ---- commented on 9-8-2025 for error in offscreen extraction -------------
// // offscreen-content.js - Script to run inside the offscreen document for silent extraction
// let extractionAttempted = false
// let retryCount = 0
// const MAX_RETRIES = 3
// const EXTRACTION_TIMEOUT = 30000 // 30 seconds
// const RETRY_DELAY = 3000 // 3 seconds between retries

// console.log("Bloomix Extractor: Offscreen content script loaded.")

// // Updated selectors based on the actual LinkedIn HTML structure
// function findProfileContainer() {
//   const selectors = [
//     "main.GniorShHVuXCMkZngwVQmRrvjcItTudLr",
//     'main[class*="GniorShHVuXCMkZngwVQmRrvjcItTudLr"]',
//     'main[class*="scaffold-layout"]',
//     'main[role="main"]',
//     ".scaffold-layout__main",
//     ".application-outlet main",
//     "#main-content",
//     "main",
//   ]
//   for (const selector of selectors) {
//     const container = document.querySelector(selector)
//     if (container && container.innerHTML.length > 1000) {
//       console.log(`Bloomix Extractor (Offscreen): Found profile container with selector: ${selector}`)
//       console.log(`Container content length: ${container.innerHTML.length} characters`)
//       return container
//     }
//   }
//   console.warn("Bloomix Extractor (Offscreen): Could not find profile container with any known selector")
//   return null
// }

// // Enhanced profile content detection based on actual LinkedIn structure
// function hasProfileContent() {
//   const indicators = [
//     "h1.jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg",
//     'h1[class*="jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg"]',
//     ".pv-text-details__left-panel h1",
//     'h1[class*="inline"][class*="t-24"]',
//   ]
//   let foundIndicators = 0
//   for (const selector of indicators) {
//     const element = document.querySelector(selector)
//     if (element && element.textContent.trim().length > 0) {
//       console.log(`Found profile indicator (Offscreen): ${selector} = "${element.textContent.trim().substring(0, 50)}..."`)
//       foundIndicators++
//     }
//   }
//   console.log(`Profile content check (Offscreen): Found ${foundIndicators} indicators`)
//   return foundIndicators >= 2 // Need at least 2 indicators to confirm it's a profile
// }

// // Extract specific profile information for validation
// function getProfileInfo() {
//   const info = {}
//   const nameSelectors = [
//     "h1.jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg",
//     'h1[class*="jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg"]',
//     ".pv-text-details__left-panel h1",
//     'h1[class*="inline"][class*="t-24"]',
//   ]
//   for (const selector of nameSelectors) {
//     const nameEl = document.querySelector(selector)
//     if (nameEl && nameEl.textContent.trim()) {
//       info.name = nameEl.textContent.trim()
//       break
//     }
//   }
//   const headlineSelectors = [
//     ".text-body-medium.break-words[data-generated-suggestion-target]",
//     ".pv-text-details__left-panel .text-body-medium",
//     '[class*="text-body-medium"][class*="break-words"]',
//   ]
//   for (const selector of headlineSelectors) {
//     const headlineEl = document.querySelector(selector)
//     if (headlineEl && headlineEl.textContent.trim()) {
//       info.headline = headlineEl.textContent.trim()
//       break
//     }
//   }
//   const locationSelectors = [
//     ".text-body-small.inline.t-black--light.break-words",
//     ".DIZrAHyWEgBLiCHkVNxDohPKnieYlphHkcpQ .text-body-small",
//     '[class*="text-body-small"][class*="t-black--light"]',
//   ]
//   for (const selector of locationSelectors) {
//     const locationEl = document.querySelector(selector)
//     if (
//       locationEl &&
//       locationEl.textContent.trim() &&
//       !locationEl.textContent.includes("followers") &&
//       !locationEl.textContent.includes("connections")
//     ) {
//       info.location = locationEl.textContent.trim()
//       break
//     }
//   }
//   return info
// }

// // Modified to accept searchId
// async function performExtraction(url, searchId) {
//   if (extractionAttempted) {
//     console.log("Bloomix Extractor (Offscreen): Extraction already attempted, skipping")
//     return
//   }
//   extractionAttempted = true
//   console.log(`Bloomix Extractor (Offscreen): Starting extraction attempt ${retryCount + 1}/${MAX_RETRIES} for ${url} (Search ID: ${searchId})`)
//   try {
//     await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait for content to load

//     if (!hasProfileContent()) {
//       throw new Error("Profile content not detected on page")
//     }

//     const profileInfo = getProfileInfo()
//     console.log("Profile info detected (Offscreen):", profileInfo)
//     if (!profileInfo.name) {
//       throw new Error("Could not find profile name - page may not be fully loaded")
//     }

//     const profileContainer = findProfileContainer()
//     if (!profileContainer) {
//       throw new Error("Could not find profile container element")
//     }

//     let domContent = profileContainer.innerHTML
//     if (!domContent || domContent.length < 1000) {
//       domContent = document.body.innerHTML
//       console.log("Using document.body as fallback for content extraction (Offscreen)")
//     }
//     if (!domContent || domContent.length < 500) {
//       throw new Error(`Extracted DOM content is too short (${domContent.length} chars)`)
//     }

//     const cleanContent = domContent
//       .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
//       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
//       .replace(/[\s\S]*?/g, "")
//       .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")

//     console.log(`Bloomix Extractor (Offscreen): Extraction successful for ${url}!`)
//     console.log(`Profile: ${profileInfo.name}`)
//     console.log(`Content length: ${cleanContent.length} chars`)

//     chrome.runtime.sendMessage({
//       action: "extractionCompleteOffscreen", // New action for offscreen completion
//       success: true,
//       domContent: cleanContent,
//       error: null,
//       url: url,
//       searchId: searchId, // Pass searchId here
//       extractionMethod: "offscreen-v1",
//       contentLength: cleanContent.length,
//       profileInfo: profileInfo,
//     })
//   } catch (error) {
//     console.error(`Bloomix Extractor (Offscreen): Extraction attempt ${retryCount + 1} failed for ${url}:`, error)
//     retryCount++
//     if (retryCount < MAX_RETRIES) {
//       console.log(`Bloomix Extractor (Offscreen): Retrying in ${RETRY_DELAY}ms...`)
//       extractionAttempted = false // Reset for retry
//       setTimeout(() => performExtraction(url, searchId), RETRY_DELAY) // Pass searchId on retry
//       return
//     }

//     chrome.runtime.sendMessage({
//       action: "extractionCompleteOffscreen",
//       success: false,
//       domContent: null,
//       error: `Extraction failed after ${MAX_RETRIES} attempts: ${error.message}`,
//       url: url,
//       searchId: searchId, // Pass searchId here
//       extractionMethod: "offscreen-v1",
//       retryCount: retryCount,
//     })
//   }
// }

// function isLinkedInProfilePage(url) {
//   const isProfile = url.includes("linkedin.com/in/") && !url.includes("/edit/") && !url.includes("/overlay/")
//   console.log(`URL validation (Offscreen): ${url} -> isProfile: ${isProfile}`)
//   return isProfile
// }

// function waitForProfileContent() {
//   return new Promise((resolve, reject) => {
//     let checkCount = 0
//     const maxChecks = 60 // 60 seconds total
//     const checkInterval = setInterval(() => {
//       checkCount++
//       console.log(`Bloomix Extractor (Offscreen): Content check ${checkCount}/${maxChecks}`)
//       if (hasProfileContent()) {
//         clearInterval(checkInterval)
//         console.log("Bloomix Extractor (Offscreen): Profile content detected!")
//         const profileInfo = getProfileInfo()
//         console.log("Detected profile info (Offscreen):", profileInfo)
//         resolve()
//         return
//       }
//       if (checkCount >= maxChecks) {
//         clearInterval(checkInterval)
//         reject(new Error("Timeout waiting for profile content to load"))
//       }
//     }, 1000)
//   })
// }

// // Listen for messages from the background script
// chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
//   if (message.action === "loadUrlAndExtract") {
//     const { url, searchId } = message // Destructure searchId from the message
//     console.log(`Offscreen: Received request to load and extract: ${url} for search ${searchId}`)
//     extractionAttempted = false // Reset for new URL
//     retryCount = 0

//     if (!isLinkedInProfilePage(url)) {
//       console.log("Offscreen: Not a LinkedIn profile page, skipping extraction.")
//       chrome.runtime.sendMessage({
//         action: "extractionCompleteOffscreen",
//         success: false,
//         domContent: null,
//         error: "Not a LinkedIn profile page",
//         url: url,
//         searchId: searchId, // Pass searchId here
//         extractionMethod: "offscreen-v1",
//       })
//       sendResponse({ success: false, error: "Not a LinkedIn profile page" })
//       return true // Keep port open for async response
//     }

//     try {
//       // Navigate the offscreen document
//       window.location.href = url
//       // Wait for the page to load and content to appear
//       await waitForProfileContent()
//       // Give it a little more time for rendering
//       await new Promise((resolve) => setTimeout(resolve, 3000))
//       await performExtraction(url, searchId) // Pass searchId to performExtraction
//       sendResponse({ success: true })
//     } catch (error) {
//       console.error("Offscreen: Error during loadUrlAndExtract:", error)
//       chrome.runtime.sendMessage({
//         action: "extractionCompleteOffscreen",
//         success: false,
//         domContent: null,
//         error: `Offscreen extraction failed: ${error.message}`,
//         url: url,
//         searchId: searchId, // Pass searchId here
//         extractionMethod: "offscreen-v1",
//       })
//       sendResponse({ success: false, error: error.message })
//     }
//     return true // Keep port open for async response
//   }
// });

// Initial check for document ready state is not strictly necessary here
// as the offscreen document is loaded by the background script.
// The message listener will handle the "start" signal.


// // offscreen-content.js - Script to run inside the offscreen document for silent extraction
// let extractionAttempted = false
// let retryCount = 0
// const MAX_RETRIES = 3
// const EXTRACTION_TIMEOUT = 30000 // 30 seconds
// const RETRY_DELAY = 3000 // 3 seconds between retries

// console.log("Bloomix Extractor: Offscreen content script loaded.")

// // Updated selectors based on the actual LinkedIn HTML structure
// function findProfileContainer() {
//   const selectors = [
//     "main.GniorShHVuXCMkZngwVQmRrvjcItTudLr",
//     'main[class*="GniorShHVuXCMkZngwVQmRrvjcItTudLr"]',
//     'main[class*="scaffold-layout"]',
//     'main[role="main"]',
//     ".scaffold-layout__main",
//     ".application-outlet main",
//     "#main-content",
//     "main",
//   ]
//   for (const selector of selectors) {
//     const container = document.querySelector(selector)
//     if (container && container.innerHTML.length > 1000) {
//       console.log(`Bloomix Extractor (Offscreen): Found profile container with selector: ${selector}`)
//       console.log(`Container content length: ${container.innerHTML.length} characters`)
//       return container
//     }
//   }
//   console.warn("Bloomix Extractor (Offscreen): Could not find profile container with any known selector")
//   return null
// }

// // Enhanced profile content detection based on actual LinkedIn structure
// function hasProfileContent() {
//   const indicators = [
//     "h1.jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg",
//     'h1[class*="jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg"]',
//     ".text-body-medium.break-words[data-generated-suggestion-target]",
//     ".pv-top-card-profile-picture__image--show",
//     ".BpEfxZZRdCXNKvDMBXneKNigyTHPXysPWXvV",
//     ".text-body-small.inline.t-black--light.break-words",
//     "[data-member-id]",
//     ".pv-text-details__left-panel h1",
//     ".ph5.pb5 h1",
//   ]
//   let foundIndicators = 0
//   for (const selector of indicators) {
//     const element = document.querySelector(selector)
//     if (element && element.textContent.trim().length > 0) {
//       console.log(`Found profile indicator (Offscreen): ${selector} = "${element.textContent.trim().substring(0, 50)}..."`)
//       foundIndicators++
//     }
//   }
//   console.log(`Profile content check (Offscreen): Found ${foundIndicators} indicators`)
//   return foundIndicators >= 2 // Need at least 2 indicators to confirm it's a profile
// }

// // Extract specific profile information for validation
// function getProfileInfo() {
//   const info = {}
//   const nameSelectors = [
//     "h1.jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg",
//     'h1[class*="jOJslXLNBppXppQWwiPnEVudDBhMLRIPMOtxHg"]',
//     ".pv-text-details__left-panel h1",
//     'h1[class*="inline"][class*="t-24"]',
//   ]
//   for (const selector of nameSelectors) {
//     const nameEl = document.querySelector(selector)
//     if (nameEl && nameEl.textContent.trim()) {
//       info.name = nameEl.textContent.trim()
//       break
//     }
//   }
//   const headlineSelectors = [
//     ".text-body-medium.break-words[data-generated-suggestion-target]",
//     ".pv-text-details__left-panel .text-body-medium",
//     '[class*="text-body-medium"][class*="break-words"]',
//   ]
//   for (const selector of headlineSelectors) {
//     const headlineEl = document.querySelector(selector)
//     if (headlineEl && headlineEl.textContent.trim()) {
//       info.headline = headlineEl.textContent.trim()
//       break
//     }
//   }
//   const locationSelectors = [
//     ".text-body-small.inline.t-black--light.break-words",
//     ".DIZrAHyWEgBLiCHkVNxDohPKnieYlphHkcpQ .text-body-small",
//     '[class*="text-body-small"][class*="t-black--light"]',
//   ]
//   for (const selector of locationSelectors) {
//     const locationEl = document.querySelector(selector)
//     if (
//       locationEl &&
//       locationEl.textContent.trim() &&
//       !locationEl.textContent.includes("followers") &&
//       !locationEl.textContent.includes("connections")
//     ) {
//       info.location = locationEl.textContent.trim()
//       break
//     }
//   }
//   return info
// }

// async function performExtraction(url) {
//   if (extractionAttempted) {
//     console.log("Bloomix Extractor (Offscreen): Extraction already attempted, skipping")
//     return
//   }
//   extractionAttempted = true
//   console.log(`Bloomix Extractor (Offscreen): Starting extraction attempt ${retryCount + 1}/${MAX_RETRIES} for ${url}`)
//   try {
//     await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait for content to load

//     if (!hasProfileContent()) {
//       throw new Error("Profile content not detected on page")
//     }

//     const profileInfo = getProfileInfo()
//     console.log("Profile info detected (Offscreen):", profileInfo)
//     if (!profileInfo.name) {
//       throw new Error("Could not find profile name - page may not be fully loaded")
//     }

//     const profileContainer = findProfileContainer()
//     if (!profileContainer) {
//       throw new Error("Could not find profile container element")
//     }

//     let domContent = profileContainer.innerHTML
//     if (!domContent || domContent.length < 1000) {
//       domContent = document.body.innerHTML
//       console.log("Using document.body as fallback for content extraction (Offscreen)")
//     }
//     if (!domContent || domContent.length < 500) {
//       throw new Error(`Extracted DOM content is too short (${domContent.length} chars)`)
//     }

//     const cleanContent = domContent
//       .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
//       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
//       .replace(/[\s\S]*?/g, "")
//       .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")

//     console.log(`Bloomix Extractor (Offscreen): Extraction successful for ${url}!`)
//     console.log(`Profile: ${profileInfo.name}`)
//     console.log(`Content length: ${cleanContent.length} chars`)

//     chrome.runtime.sendMessage({
//       action: "extractionCompleteOffscreen", // New action for offscreen completion
//       success: true,
//       domContent: cleanContent,
//       error: null,
//       url: url,
//       extractionMethod: "offscreen-v1",
//       contentLength: cleanContent.length,
//       profileInfo: profileInfo,
//     })
//   } catch (error) {
//     console.error(`Bloomix Extractor (Offscreen): Extraction attempt ${retryCount + 1} failed for ${url}:`, error)
//     retryCount++
//     if (retryCount < MAX_RETRIES) {
//       console.log(`Bloomix Extractor (Offscreen): Retrying in ${RETRY_DELAY}ms...`)
//       extractionAttempted = false // Reset for retry
//       setTimeout(() => performExtraction(url), RETRY_DELAY)
//       return
//     }

//     chrome.runtime.sendMessage({
//       action: "extractionCompleteOffscreen",
//       success: false,
//       domContent: null,
//       error: `Extraction failed after ${MAX_RETRIES} attempts: ${error.message}`,
//       url: url,
//       extractionMethod: "offscreen-v1",
//       retryCount: retryCount,
//     })
//   }
// }

// function isLinkedInProfilePage(url) {
//   const isProfile = url.includes("linkedin.com/in/") && !url.includes("/edit/") && !url.includes("/overlay/")
//   console.log(`URL validation (Offscreen): ${url} -> isProfile: ${isProfile}`)
//   return isProfile
// }

// function waitForProfileContent() {
//   return new Promise((resolve, reject) => {
//     let checkCount = 0
//     const maxChecks = 60 // 60 seconds total
//     const checkInterval = setInterval(() => {
//       checkCount++
//       console.log(`Bloomix Extractor (Offscreen): Content check ${checkCount}/${maxChecks}`)
//       if (hasProfileContent()) {
//         clearInterval(checkInterval)
//         console.log("Bloomix Extractor (Offscreen): Profile content detected!")
//         const profileInfo = getProfileInfo()
//         console.log("Detected profile info (Offscreen):", profileInfo)
//         resolve()
//         return
//       }
//       if (checkCount >= maxChecks) {
//         clearInterval(checkInterval)
//         reject(new Error("Timeout waiting for profile content to load"))
//       }
//     }, 1000)
//   })
// }

// // Listen for messages from the background script
// chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
//   if (message.action === "loadUrlAndExtract") {
//     const { url } = message
//     console.log(`Offscreen: Received request to load and extract: ${url}`)
//     extractionAttempted = false // Reset for new URL
//     retryCount = 0

//     if (!isLinkedInProfilePage(url)) {
//       console.log("Offscreen: Not a LinkedIn profile page, skipping extraction.")
//       chrome.runtime.sendMessage({
//         action: "extractionCompleteOffscreen",
//         success: false,
//         domContent: null,
//         error: "Not a LinkedIn profile page",
//         url: url,
//         extractionMethod: "offscreen-v1",
//       })
//       sendResponse({ success: false, error: "Not a LinkedIn profile page" })
//       return true // Keep port open for async response
//     }

//     try {
//       // Navigate the offscreen document
//       window.location.href = url
//       // Wait for the page to load and content to appear
//       await waitForProfileContent()
//       // Give it a little more time for rendering
//       await new Promise((resolve) => setTimeout(resolve, 3000))
//       await performExtraction(url)
//       sendResponse({ success: true })
//     } catch (error) {
//       console.error("Offscreen: Error during loadUrlAndExtract:", error)
//       chrome.runtime.sendMessage({
//         action: "extractionCompleteOffscreen",
//         success: false,
//         domContent: null,
//         error: `Offscreen extraction failed: ${error.message}`,
//         url: url,
//         extractionMethod: "offscreen-v1",
//       })
//       sendResponse({ success: false, error: error.message })
//     }
//     return true // Keep port open for async response
//   }
// });

// // Initial check for document ready state is not strictly necessary here
// // as the offscreen document is loaded by the background script.
// // The message listener will handle the "start" signal.
