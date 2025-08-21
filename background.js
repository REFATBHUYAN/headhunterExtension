// background.js - Enhanced version with improved DOM visibility and error handling

const BACKEND_URL = "https://bloomix-frontend-test.onrender.com/v1"
// const BACKEND_URL = "http://localhost:5000/v1"
const SEARCHES_STORAGE_KEY = "activeSearches"
const EXTRACTION_TIMEOUT = 45000
const TAB_LOAD_TIMEOUT = 15000
const MAX_CONCURRENT_TABS = 1
const QUEUE_ADVANCE_DELAY = 3000
const TAB_CREATION_DELAY = 2000
const MAX_TAB_ERRORS = 3
const DOM_READY_WAIT = 7000 // Increased wait for LinkedIn DOM

console.log("🚀 Bloomix Extractor: Enhanced background script starting...")

// Enhanced storage functions
async function getStorage(key) {
  try {
    const result = await chrome.storage.session.get(key)
    const data = result[key] || {}

    for (const searchId in data) {
      if (data[searchId].completedUrls) {
        if (Array.isArray(data[searchId].completedUrls)) {
          data[searchId].completedUrls = new Set(data[searchId].completedUrls)
        } else {
          data[searchId].completedUrls = new Set()
        }
      }
      if (!data[searchId].consecutiveErrors) {
        data[searchId].consecutiveErrors = 0
      }
    }

    return data
  } catch (error) {
    console.error(`❌ Error getting storage for ${key}:`, error)
    return {}
  }
}

async function setStorage(key, value) {
  try {
    const storageData = {}
    for (const searchId in value) {
      storageData[searchId] = { ...value[searchId] }
      if (storageData[searchId].completedUrls instanceof Set) {
        storageData[searchId].completedUrls = Array.from(storageData[searchId].completedUrls)
      }
    }

    await chrome.storage.session.set({ [key]: storageData })
    console.log(`✅ Storage set for ${key}`)
  } catch (error) {
    console.error(`❌ Error setting storage for ${key}:`, error)
  }
}

// Enhanced badge management
async function updateBadge(text) {
  try {
    await chrome.action.setBadgeText({ text })
    await chrome.action.setBadgeBackgroundColor({ color: "#007bff" })
  } catch (error) {
    console.error("❌ Error updating badge:", error)
  }
}

async function clearBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" })
  } catch (error) {
    console.error("❌ Error clearing badge:", error)
  }
}

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log("🔧 Bloomix Extractor: Extension installed/updated")
  setStorage(SEARCHES_STORAGE_KEY, {})
  clearBadge()
})

chrome.runtime.onStartup.addListener(async () => {
  console.log("🔧 Bloomix Extractor: Service worker startup")
  await setStorage(SEARCHES_STORAGE_KEY, {})
  await clearBadge()
})

// Enhanced message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("📨 Background received message:", {
    action: request.action,
    from: sender.tab?.id || sender.documentId || "unknown",
    hasSearchId: !!request.searchId,
  })

  if (request.action === "keepAlive") {
    sendResponse({ success: true, message: "Service worker alive" })
    return true
  }

  const handleAsync = async () => {
    try {
      let result
      switch (request.action) {
        case "startSearch":
          console.log("🚀 Starting search:", request.searchId)
          result = await handleStartSearch(request)
          break
        case "stopSearch":
          console.log("🛑 Stopping search:", request.searchId)
          result = await handleStopSearch(request)
          break
        case "getActiveSearches":
          result = await handleGetActiveSearches()
          break
        case "ping":
          result = { success: true, message: "Extension connected" }
          break
        case "extractionComplete":
          console.log("✅ Extraction completion received:", {
            success: request.success,
            profileUrl: request.profileUrl || request.url,
            searchId: request.searchId,
            tabId: sender.tab?.id,
          })

          if (request.searchId) {
            await handleExtractionComplete(request, sender.tab?.id)
          } else {
            await sendToBackend(
              request.backendUrl || BACKEND_URL,
              {
                ...request,
                profileUrl: request.profileUrl || request.url,
              },
              "/api/headhunter/process-linkedin-dom",
            )
          }

          result = { success: true, message: "Extraction processed" }
          break
        default:
          result = { success: false, error: "Unknown action" }
      }
      sendResponse(result)
    } catch (error) {
      console.error(`❌ Error handling ${request.action}:`, error)
      sendResponse({ success: false, error: error.message })
    }
  }
  
  handleAsync()
  return true
})

// Enhanced search handling
async function handleStartSearch(request) {
  try {
    console.log("🔍 handleStartSearch called with:", {
      searchId: request.searchId,
      urlCount: request.urls?.length,
    })

    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const { searchId, urls, backendUrl } = request

    if (!searchId || !urls || !Array.isArray(urls)) {
      throw new Error("Invalid search parameters")
    }

    console.log(`Initializing fresh search session for ${searchId}`)
    
    const linkedinUrls = urls.filter((url) => url && url.includes("linkedin.com/in/"))
    console.log(`📊 Filtered URLs: ${linkedinUrls.length} LinkedIn profiles`)

    // Initialize search session
    searches.set(searchId, {
      searchId,
      backendUrl: backendUrl || BACKEND_URL,
      urls: linkedinUrls,
      processedCount: 0,
      completedUrls: new Set(),
      isStopping: false,
      startTime: Date.now(),
      activeExtractions: [],
      currentIndex: 0,
      consecutiveErrors: 0,
      totalErrors: 0,
      lastProcessedTime: Date.now()
    })

    await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
    console.log(`✅ Search ${searchId} stored with ${linkedinUrls.length} URLs`)

    // Start processing with initial delay
    setTimeout(() => processSequentially(searchId), 2000)

    return { success: true, message: "Search started successfully" }
  } catch (error) {
    console.error("❌ Error starting search:", error)
    return { success: false, error: error.message }
  }
}

// Enhanced sequential processing
async function processSequentially(searchId) {
  try {
    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const searchSession = searches.get(searchId)

    if (!searchSession) {
      console.log(`❌ Search ${searchId} not found`)
      return
    }

    if (searchSession.isStopping) {
      console.log(`⏹️ Search ${searchId} is stopping`)
      await finishSearch(searchId)
      return
    }

    const { urls, completedUrls, currentIndex } = searchSession

    // Ensure completedUrls is a Set
    if (!(completedUrls instanceof Set)) {
      searchSession.completedUrls = new Set(completedUrls || [])
    }

    const totalCompleted = searchSession.completedUrls.size

    // Check if we're done
    if (totalCompleted >= urls.length || currentIndex >= urls.length) {
      console.log(`✅ All URLs completed for search ${searchId} (${totalCompleted}/${urls.length})`)
      await finishSearch(searchId)
      return
    }

    // Detect stalled processing
    const timeSinceLastProcess = Date.now() - (searchSession.lastProcessedTime || searchSession.startTime)
    if (timeSinceLastProcess > 300000) { // 5 minutes
      console.warn(`⚠️ Search ${searchId} appears stalled, attempting recovery...`)
      searchSession.consecutiveErrors = 0
      searchSession.lastProcessedTime = Date.now()
    }

    // Find next URL to process
    let nextUrl = null
    let nextIndex = currentIndex

    for (let i = currentIndex; i < urls.length; i++) {
      const url = urls[i]
      if (!searchSession.completedUrls.has(url)) {
        nextUrl = url
        nextIndex = i
        break
      }
    }

    if (!nextUrl) {
      console.log(`✅ No more URLs to process for search ${searchId}`)
      await finishSearch(searchId)
      return
    }

    // Update current index and progress
    searchSession.currentIndex = nextIndex + 1
    searchSession.lastProcessedTime = Date.now()
    await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

    console.log(`🔄 Processing URL ${nextIndex + 1}/${urls.length}: ${nextUrl}`)
    console.log(`📈 Progress: ${totalCompleted} completed, ${searchSession.consecutiveErrors} consecutive errors`)
    
    await updateBadge(`${totalCompleted + 1}/${urls.length}`)

    // Process the URL
    await processUrlWithRecovery(searchId, nextUrl, nextIndex)
    
  } catch (error) {
    console.error(`❌ Critical error in sequential processing for search ${searchId}:`, error)
    
    // Force continue to prevent getting stuck
    setTimeout(() => {
      console.log(`🚨 EMERGENCY: Force continuing search ${searchId} after critical error`)
      processSequentially(searchId)
    }, QUEUE_ADVANCE_DELAY)
  }
}

// IMPROVED: Better URL processing with DOM visibility optimization
async function processUrlWithRecovery(searchId, url, urlIndex) {
  const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
  const searchSession = searches.get(searchId)

  if (!searchSession) {
    console.error(`❌ Search session ${searchId} not found`)
    return
  }

  let tab = null

  try {
    console.log(`🆕 Creating active tab for better DOM visibility: ${url}`)

    // Progressive delay based on consecutive errors
    const errorDelay = Math.min(searchSession.consecutiveErrors * 1500, 8000)
    const baseDelay = TAB_CREATION_DELAY + errorDelay
    
    await new Promise((resolve) => setTimeout(resolve, baseDelay))

    // Create new active tab for better DOM rendering
    try {
      tab = await chrome.tabs.create({
        url: url,
        active: true, // Ensures proper DOM rendering
        pinned: false,
      })
      console.log(`✅ Created active tab ${tab.id} for ${url}`)
    } catch (tabError) {
      console.error(`❌ Failed to create tab for ${url}:`, tabError)
      await handleUrlError(searchId, url, `Tab creation failed: ${tabError.message}`)
      return
    }

    // Track extraction
    const extraction = {
      url,
      tabId: tab.id,
      startTime: Date.now(),
      timeout: null,
      loadTimeout: null,
      urlIndex,
      injectionAttempted: false
    }

    searchSession.activeExtractions = searchSession.activeExtractions || []
    searchSession.activeExtractions.push(extraction)

    // Enhanced tab loading with multiple injection attempts
    let injectionSuccessful = false
    let loadCheckCount = 0
    const maxLoadChecks = 30

    const tabUpdateListener = (tabId, changeInfo, updatedTab) => {
      if (tabId === tab.id && !extraction.injectionAttempted) {
        console.log(`Tab ${tab.id} update:`, changeInfo)

        // Try injection on various completion signals
        if (changeInfo.status === "complete" || 
            (changeInfo.url && changeInfo.url.includes("linkedin.com/in/")) ||
            updatedTab.status === "complete") {
          
          extraction.injectionAttempted = true
          chrome.tabs.onUpdated.removeListener(tabUpdateListener)

          if (extraction.loadTimeout) {
            clearTimeout(extraction.loadTimeout)
          }

          console.log(`🔄 Tab ${tab.id} loaded, waiting for DOM then injecting...`)

          // IMPROVED: Multi-stage injection for better success rate
          performMultiStageInjection(searchId, tab.id, extraction)
        }
      }
    }

    chrome.tabs.onUpdated.addListener(tabUpdateListener)

    // Enhanced load monitoring
    const checkTabLoading = async () => {
      loadCheckCount++
      
      try {
        const currentTab = await chrome.tabs.get(tab.id)
        console.log(`Checking tab ${tab.id} loading: ${loadCheckCount}/${maxLoadChecks}`)

        if (loadCheckCount >= maxLoadChecks && !extraction.injectionAttempted) {
          extraction.injectionAttempted = true
          chrome.tabs.onUpdated.removeListener(tabUpdateListener)
          console.log(`⏰ Tab ${tab.id} loading timeout, attempting injection anyway...`)

          // Force injection on timeout
          await performMultiStageInjection(searchId, tab.id, extraction)
        } else if (!extraction.injectionAttempted) {
          extraction.loadTimeout = setTimeout(checkTabLoading, 1000)
        }
      } catch (tabError) {
        console.error(`❌ Tab ${tab.id} error during loading:`, tabError)
        chrome.tabs.onUpdated.removeListener(tabUpdateListener)
        await handleUrlError(searchId, url, `Tab became invalid: ${tabError.message}`)
      }
    }

    extraction.loadTimeout = setTimeout(checkTabLoading, 1500)

    // Overall extraction timeout
    extraction.timeout = setTimeout(async () => {
      console.log(`⏰ Overall extraction timeout for ${url} (tab ${tab.id})`)
      await handleExtractionTimeout(searchId, url, tab.id)
    }, EXTRACTION_TIMEOUT)

    await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

  } catch (error) {
    console.error(`❌ Error processing URL ${url}:`, error)
    
    // Cleanup tab if created
    if (tab && tab.id) {
      try {
        await chrome.tabs.remove(tab.id)
      } catch (cleanupError) {
        console.warn(`⚠️ Could not cleanup tab ${tab.id}:`, cleanupError.message)
      }
    }
    
    await handleUrlError(searchId, url, `Processing error: ${error.message}`)
  }
}

// NEW: Multi-stage injection for better success rate
async function performMultiStageInjection(searchId, tabId, extraction) {
  const maxAttempts = 3
  let attempt = 0

  const tryInjection = async () => {
    attempt++
    
    try {
      console.log(`💉 Injection attempt ${attempt}/${maxAttempts} for tab ${tabId}`)
      
      // Wait for DOM to be fully ready
      await new Promise(resolve => setTimeout(resolve, DOM_READY_WAIT))
      
      // Check if tab still exists
      await chrome.tabs.get(tabId)
      
      // Attempt injection
      await chrome.tabs.sendMessage(tabId, {
        action: "setSearchContext",
        searchId: searchId,
        backendUrl: extraction.backendUrl || BACKEND_URL,
        attempt: attempt
      })
      
      console.log(`✅ Injection successful for tab ${tabId} on attempt ${attempt}`)
      return true
      
    } catch (error) {
      console.error(`❌ Injection attempt ${attempt} failed for tab ${tabId}:`, error)
      
      if (attempt < maxAttempts) {
        console.log(`🔄 Retrying injection for tab ${tabId} in 3 seconds...`)
        await new Promise(resolve => setTimeout(resolve, 3000))
        return await tryInjection()
      } else {
        console.error(`❌ All injection attempts failed for tab ${tabId}`)
        await handleUrlError(searchId, extraction.url, `All injection attempts failed: ${error.message}`)
        return false
      }
    }
  }

  return await tryInjection()
}

// Enhanced error handling with guaranteed progression
async function handleUrlError(searchId, url, errorMessage) {
  try {
    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const searchSession = searches.get(searchId)

    if (searchSession) {
      searchSession.consecutiveErrors++
      searchSession.totalErrors++
      
      console.log(`❌ URL Error for ${url}: ${errorMessage} (Consecutive: ${searchSession.consecutiveErrors})`)

      // Clean up active extractions
      if (searchSession.activeExtractions) {
        searchSession.activeExtractions = searchSession.activeExtractions.filter(ext => {
          if (ext.url === url) {
            if (ext.timeout) clearTimeout(ext.timeout)
            if (ext.loadTimeout) clearTimeout(ext.loadTimeout)
            return false
          }
          return true
        })
      }

      // Send error to backend
      try {
        await sendToBackend(
          searchSession.backendUrl,
          {
            searchId,
            profileUrl: url,
            success: false,
            error: errorMessage,
            extractionMethod: "active-tab-error",
            consecutiveErrors: searchSession.consecutiveErrors,
            totalErrors: searchSession.totalErrors
          },
          "/api/headhunter/process-linkedin-dom",
        )
      } catch (backendError) {
        console.warn(`⚠️ Backend error notification failed:`, backendError.message)
      }

      await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
    }

    // GUARANTEED: Always continue regardless of error
    console.log(`🔄 GUARANTEED continuation after error: ${errorMessage}`)
    await markUrlProcessedAndContinue(searchId, url, true)
    
  } catch (error) {
    console.error(`❌ Critical error in handleUrlError:`, error)
    // Ultimate fallback - force continue
    setTimeout(() => {
      console.log(`🚨 EMERGENCY continuation for search ${searchId}`)
      processSequentially(searchId)
    }, QUEUE_ADVANCE_DELAY)
  }
}

// Enhanced extraction completion with proper tab cleanup
async function handleExtractionComplete(request, tabId) {
  try {
    const { searchId, profileUrl, url } = request
    const finalUrl = profileUrl || url

    console.log(`🎉 Extraction completed for ${finalUrl} (tab ${tabId})`)

    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const searchSession = searches.get(searchId)

    if (searchSession) {
      // Reset consecutive errors on success
      if (request.success) {
        searchSession.consecutiveErrors = 0
      } else {
        searchSession.consecutiveErrors++
        searchSession.totalErrors++
      }

      // Clean up extraction tracking
      if (searchSession.activeExtractions) {
        const extractionIndex = searchSession.activeExtractions.findIndex(
          (extraction) => extraction.tabId === tabId || extraction.url === finalUrl
        )

        if (extractionIndex !== -1) {
          const extraction = searchSession.activeExtractions[extractionIndex]
          if (extraction.timeout) clearTimeout(extraction.timeout)
          if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
          searchSession.activeExtractions.splice(extractionIndex, 1)
          console.log(`✅ Cleaned up extraction tracking for ${finalUrl}`)
        }
      }

      await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
    }

    // Send to backend
    try {
      await sendToBackend(
        request.backendUrl || BACKEND_URL,
        {
          ...request,
          profileUrl: finalUrl,
        },
        "/api/headhunter/process-linkedin-dom",
      )
    } catch (backendError) {
      console.warn(`⚠️ Backend success notification failed:`, backendError.message)
    }

    // Close completed tab after showing success
    setTimeout(async () => {
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId)
          console.log(`🗑️ Closed completed tab ${tabId}`)
        } catch (error) {
          console.warn(`⚠️ Could not close completed tab ${tabId}:`, error.message)
        }
      }
    }, 2000)

    // Continue to next URL
    console.log(`🔄 Auto-continuing to next URL after completion...`)
    await markUrlProcessedAndContinue(searchId, finalUrl, false)
    
  } catch (error) {
    console.error("❌ Error in completion handling:", error)
    
    const finalUrl = request.profileUrl || request.url || "unknown-url"
    
    // Still close the tab
    if (tabId) {
      setTimeout(async () => {
        try {
          await chrome.tabs.remove(tabId)
        } catch (tabError) {
          console.warn(`⚠️ Cleanup tab close failed:`, tabError.message)
        }
      }, 1000)
    }
    
    // Force continue
    setTimeout(() => markUrlProcessedAndContinue(searchId, finalUrl, true), 1000)
  }
}

// Enhanced timeout handling
async function handleExtractionTimeout(searchId, url, tabId) {
  try {
    console.log(`⏰ Extraction timeout for ${url} (tab ${tabId})`)
    
    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const searchSession = searches.get(searchId)

    if (searchSession && searchSession.activeExtractions) {
      const extractionIndex = searchSession.activeExtractions.findIndex(
        (extraction) => extraction.tabId === tabId
      )

      if (extractionIndex !== -1) {
        const extraction = searchSession.activeExtractions[extractionIndex]
        if (extraction.timeout) clearTimeout(extraction.timeout)
        if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
        searchSession.activeExtractions.splice(extractionIndex, 1)
      }

      searchSession.consecutiveErrors++
      searchSession.totalErrors++
      await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
    }

    // Close timed-out tab
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId)
        console.log(`🗑️ Closed timed-out tab ${tabId}`)
      } catch (error) {
        console.warn(`⚠️ Could not close timed-out tab ${tabId}:`, error.message)
      }
    }

    // Send timeout to backend
    if (searchSession) {
      try {
        await sendToBackend(
          searchSession.backendUrl,
          {
            searchId,
            profileUrl: url,
            success: false,
            error: "Extraction timeout - LinkedIn page may be slow or blocked",
            extractionMethod: "active-tab-timeout",
            consecutiveErrors: searchSession.consecutiveErrors,
            totalErrors: searchSession.totalErrors
          },
          "/api/headhunter/process-linkedin-dom",
        )
      } catch (backendError) {
        console.warn(`⚠️ Timeout backend notification failed:`, backendError.message)
      }
    }

    // Continue to next URL
    await markUrlProcessedAndContinue(searchId, url, true)
    
  } catch (error) {
    console.error("❌ Error handling timeout:", error)
    setTimeout(() => processSequentially(searchId), QUEUE_ADVANCE_DELAY)
  }
}

// TRIPLE FAIL-SAFE continuation system
async function markUrlProcessedAndContinue(searchId, url, isError = false) {
  try {
    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const searchSession = searches.get(searchId)

    if (searchSession) {
      // Ensure completedUrls is a Set
      if (!(searchSession.completedUrls instanceof Set)) {
        searchSession.completedUrls = new Set(searchSession.completedUrls || [])
      }

      searchSession.completedUrls.add(url)
      searchSession.lastProcessedTime = Date.now()
      
      if (!isError) {
        searchSession.consecutiveErrors = 0
      }

      await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

      const progress = `${searchSession.completedUrls.size}/${searchSession.urls.length}`
      console.log(`✅ Marked ${url} as ${isError ? 'failed' : 'completed'}. Progress: ${progress}`)
    }

    // FAIL-SAFE 1: Primary continuation
    const delay = isError ? Math.min(QUEUE_ADVANCE_DELAY + 2000, 6000) : QUEUE_ADVANCE_DELAY
    console.log(`🔄 Primary continuation scheduled in ${delay}ms...`)
    
    setTimeout(() => {
      console.log(`🚀 PRIMARY: Processing next URL for search ${searchId}`)
      processSequentially(searchId)
    }, delay)

    // FAIL-SAFE 2: Backup continuation
    setTimeout(() => {
      console.log(`🛡️ BACKUP: Continuation check for search ${searchId}`)
      processSequentially(searchId)
    }, delay + 15000)

    // FAIL-SAFE 3: Emergency continuation
    setTimeout(() => {
      console.log(`🚨 EMERGENCY: Force continuation for search ${searchId}`)
      processSequentially(searchId)
    }, delay + 45000)
    
  } catch (error) {
    console.error(`❌ Error in markUrlProcessedAndContinue:`, error)
    
    // ULTIMATE EMERGENCY: Multiple continuation attempts
    for (let i = 1; i <= 5; i++) {
      setTimeout(() => {
        console.log(`🚨 ULTIMATE EMERGENCY attempt ${i}/5 for search ${searchId}`)
        processSequentially(searchId)
      }, i * QUEUE_ADVANCE_DELAY)
    }
  }
}

// Enhanced stop search
async function handleStopSearch(request) {
  try {
    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const searchSession = searches.get(request.searchId)
    
    if (searchSession) {
      searchSession.isStopping = true
      await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
      
      // Clean up active extractions
      if (searchSession.activeExtractions) {
        for (const extraction of searchSession.activeExtractions) {
          try {
            if (extraction.timeout) clearTimeout(extraction.timeout)
            if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
            if (extraction.tabId) {
              await chrome.tabs.remove(extraction.tabId)
            }
          } catch (error) {
            console.warn(`⚠️ Cleanup error:`, error)
          }
        }
      }
      
      return { success: true, message: "Search stop requested" }
    }
    return { success: false, message: "Search not found" }
  } catch (error) {
    console.error("❌ Error stopping search:", error)
    return { success: false, error: error.message }
  }
}

async function handleGetActiveSearches() {
  try {
    const searches = await getStorage(SEARCHES_STORAGE_KEY)
    return { searches: Object.keys(searches) }
  } catch (error) {
    console.error("❌ Error getting active searches:", error)
    return { searches: [] }
  }
}

async function finishSearch(searchId) {
  try {
    const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
    const searchSession = searches.get(searchId)

    console.log(`🏁 Finishing search ${searchId}`)

    // Close remaining tabs
    if (searchSession && searchSession.activeExtractions) {
      for (const extraction of searchSession.activeExtractions) {
        try {
          if (extraction.tabId) {
            await chrome.tabs.remove(extraction.tabId)
          }
          if (extraction.timeout) clearTimeout(extraction.timeout)
          if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
        } catch (error) {
          console.warn("⚠️ Final cleanup error:", error)
        }
      }
    }

    // Final statistics
    if (searchSession) {
      const completed = searchSession.completedUrls ? searchSession.completedUrls.size : 0
      const total = searchSession.urls ? searchSession.urls.length : 0
      const errors = searchSession.totalErrors || 0
      const duration = Date.now() - searchSession.startTime
      
      console.log(`📊 FINAL STATS for ${searchId}:`)
      console.log(`   ✅ Completed: ${completed}/${total} (${Math.round((completed/total)*100)}%)`)
      console.log(`   ❌ Total Errors: ${errors}`)
      console.log(`   ⏱️ Duration: ${Math.round(duration / 1000)}s`)
      console.log(`   🚀 Average per URL: ${Math.round(duration / completed)}ms`)
    }

    searches.delete(searchId)
    await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

    if (searches.size === 0) {
      await clearBadge()
    }
  } catch (error) {
    console.error(`❌ Error finishing search:`, error)
  }
}

// Enhanced backend communication
async function sendToBackend(backendUrl, data, endpointPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const fullUrl = `${backendUrl}${endpointPath}`
      console.log(`📤 Sending to backend (attempt ${attempt}/${retries}): ${data.success ? "SUCCESS" : "FAILED"} for ${data.profileUrl || data.url}`)

      const response = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Bloomix-Extension/2.0",
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error(`Backend responded with status ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      console.log(`📥 Backend response: ${result.success ? "SUCCESS" : "FAILED"}`)
      return result
      
    } catch (error) {
      console.error(`❌ Backend error (attempt ${attempt}/${retries}):`, error.message)
      if (attempt === retries) {
        console.error(`❌ FINAL backend failure for ${data.profileUrl || data.url}`)
        throw error
      } else {
        console.log(`⏳ Retrying backend call in ${1000 * attempt}ms...`)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }
}

// Enhanced tab monitoring for debugging
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  console.log(`🗑️ Tab ${tabId} was removed (windowClosing: ${removeInfo.windowClosing})`)
})

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url && tab.url.includes("linkedin.com/in/")) {
    console.log(`🆕 LinkedIn tab created: ${tab.id} - ${tab.url}`)
  }
})

// Keep service worker alive
setInterval(() => {
  console.log("💓 Service worker heartbeat - staying alive...")
}, 30000)

console.log("🎉 Bloomix Extractor: Enhanced background service worker fully initialized")

// ---- working on 21-8-2025 with new active tab creation and guaranteed progression ----
// // background.js - Enhanced version with new active tab creation and guaranteed progression
// const BACKEND_URL = "http://localhost:5000/v1"
// const SEARCHES_STORAGE_KEY = "activeSearches"
// const EXTRACTION_TIMEOUT = 45000
// const TAB_LOAD_TIMEOUT = 15000
// const MAX_CONCURRENT_TABS = 1
// const QUEUE_ADVANCE_DELAY = 3000
// const TAB_CREATION_DELAY = 2000
// const MAX_TAB_ERRORS = 3 // Maximum consecutive tab errors before switching strategy

// console.log("🚀 Bloomix Extractor: Enhanced background script starting...")

// // Enhanced storage functions
// async function getStorage(key) {
//   try {
//     const result = await chrome.storage.session.get(key)
//     const data = result[key] || {}

//     for (const searchId in data) {
//       if (data[searchId].completedUrls) {
//         if (Array.isArray(data[searchId].completedUrls)) {
//           data[searchId].completedUrls = new Set(data[searchId].completedUrls)
//         } else {
//           data[searchId].completedUrls = new Set()
//         }
//       }
//       // Initialize error tracking
//       if (!data[searchId].consecutiveErrors) {
//         data[searchId].consecutiveErrors = 0
//       }
//     }

//     return data
//   } catch (error) {
//     console.error(`❌ Error getting storage for ${key}:`, error)
//     return {}
//   }
// }

// async function setStorage(key, value) {
//   try {
//     const storageData = {}
//     for (const searchId in value) {
//       storageData[searchId] = { ...value[searchId] }
//       if (storageData[searchId].completedUrls instanceof Set) {
//         storageData[searchId].completedUrls = Array.from(storageData[searchId].completedUrls)
//       }
//     }

//     await chrome.storage.session.set({ [key]: storageData })
//     console.log(`✅ Storage set for ${key}`)
//   } catch (error) {
//     console.error(`❌ Error setting storage for ${key}:`, error)
//   }
// }

// // Enhanced badge management
// async function updateBadge(text) {
//   try {
//     await chrome.action.setBadgeText({ text })
//     await chrome.action.setBadgeBackgroundColor({ color: "#007bff" })
//   } catch (error) {
//     console.error("❌ Error updating badge:", error)
//   }
// }

// async function clearBadge() {
//   try {
//     await chrome.action.setBadgeText({ text: "" })
//   } catch (error) {
//     console.error("❌ Error clearing badge:", error)
//   }
// }

// // Initialize
// chrome.runtime.onInstalled.addListener(() => {
//   console.log("🔧 Bloomix Extractor: Extension installed/updated")
//   setStorage(SEARCHES_STORAGE_KEY, {})
//   clearBadge()
// })

// chrome.runtime.onStartup.addListener(async () => {
//   console.log("🔧 Bloomix Extractor: Service worker startup")
//   await setStorage(SEARCHES_STORAGE_KEY, {})
//   await clearBadge()
// })

// // Enhanced message handling with better error recovery
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   console.log("📨 Background received message:", {
//     action: request.action,
//     from: sender.tab?.id || sender.documentId || "unknown",
//     hasSearchId: !!request.searchId,
//   })

//   if (request.action === "keepAlive") {
//     sendResponse({ success: true, message: "Service worker alive" })
//     return true
//   }

//   const handleAsync = async () => {
//     try {
//       let result
//       switch (request.action) {
//         case "startSearch":
//           console.log("🚀 Starting search:", request.searchId)
//           result = await handleStartSearch(request)
//           break
//         case "stopSearch":
//           console.log("🛑 Stopping search:", request.searchId)
//           result = await handleStopSearch(request)
//           break
//         case "getActiveSearches":
//           result = await handleGetActiveSearches()
//           break
//         case "ping":
//           result = { success: true, message: "Extension connected" }
//           break
//         case "extractionComplete":
//           console.log("✅ Extraction completion received:", {
//             success: request.success,
//             profileUrl: request.profileUrl || request.url,
//             searchId: request.searchId,
//             tabId: sender.tab?.id,
//           })

//           if (request.searchId) {
//             await handleExtractionComplete(request, sender.tab?.id)
//           } else {
//             await sendToBackend(
//               request.backendUrl || BACKEND_URL,
//               {
//                 ...request,
//                 profileUrl: request.profileUrl || request.url,
//               },
//               "/api/headhunter/process-linkedin-dom",
//             )
//           }

//           result = { success: true, message: "Extraction processed" }
//           break
//         default:
//           result = { success: false, error: "Unknown action" }
//       }
//       sendResponse(result)
//     } catch (error) {
//       console.error(`❌ Error handling ${request.action}:`, error)
//       sendResponse({ success: false, error: error.message })
//     }
//   }
  
//   handleAsync()
//   return true
// })

// // Enhanced search handling
// async function handleStartSearch(request) {
//   try {
//     console.log("🔍 handleStartSearch called with:", {
//       searchId: request.searchId,
//       urlCount: request.urls?.length,
//     })

//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const { searchId, urls, backendUrl } = request

//     if (!searchId || !urls || !Array.isArray(urls)) {
//       throw new Error("Invalid search parameters")
//     }

//     console.log(`Initializing fresh search session for ${searchId}`)
    
//     const linkedinUrls = urls.filter((url) => url && url.includes("linkedin.com/in/"))
//     console.log(`📊 Filtered URLs: ${linkedinUrls.length} LinkedIn profiles`)

//     // Initialize search session with error tracking
//     searches.set(searchId, {
//       searchId,
//       backendUrl: backendUrl || BACKEND_URL,
//       urls: linkedinUrls,
//       processedCount: 0,
//       completedUrls: new Set(),
//       isStopping: false,
//       startTime: Date.now(),
//       activeExtractions: [],
//       currentIndex: 0,
//       consecutiveErrors: 0,
//       totalErrors: 0,
//       lastProcessedTime: Date.now()
//     })

//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     console.log(`✅ Search ${searchId} stored with ${linkedinUrls.length} URLs`)

//     // Start processing with initial delay
//     setTimeout(() => processSequentially(searchId), 2000)

//     return { success: true, message: "Search started successfully" }
//   } catch (error) {
//     console.error("❌ Error starting search:", error)
//     return { success: false, error: error.message }
//   }
// }

// // Enhanced sequential processing with comprehensive error handling
// async function processSequentially(searchId) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (!searchSession) {
//       console.log(`❌ Search ${searchId} not found`)
//       return
//     }

//     if (searchSession.isStopping) {
//       console.log(`⏹️ Search ${searchId} is stopping`)
//       await finishSearch(searchId)
//       return
//     }

//     const { urls, completedUrls, currentIndex } = searchSession

//     // Ensure completedUrls is a Set
//     if (!(completedUrls instanceof Set)) {
//       searchSession.completedUrls = new Set(completedUrls || [])
//     }

//     const totalCompleted = searchSession.completedUrls.size

//     // Check if we're done
//     if (totalCompleted >= urls.length || currentIndex >= urls.length) {
//       console.log(`✅ All URLs completed for search ${searchId} (${totalCompleted}/${urls.length})`)
//       await finishSearch(searchId)
//       return
//     }

//     // Detect stalled processing (no progress for 5 minutes)
//     const timeSinceLastProcess = Date.now() - (searchSession.lastProcessedTime || searchSession.startTime)
//     if (timeSinceLastProcess > 300000) { // 5 minutes
//       console.warn(`⚠️ Search ${searchId} appears stalled, attempting recovery...`)
//       searchSession.consecutiveErrors = 0 // Reset error count
//       searchSession.lastProcessedTime = Date.now()
//     }

//     // Find next URL to process
//     let nextUrl = null
//     let nextIndex = currentIndex

//     for (let i = currentIndex; i < urls.length; i++) {
//       const url = urls[i]
//       if (!searchSession.completedUrls.has(url)) {
//         nextUrl = url
//         nextIndex = i
//         break
//       }
//     }

//     if (!nextUrl) {
//       console.log(`✅ No more URLs to process for search ${searchId}`)
//       await finishSearch(searchId)
//       return
//     }

//     // Update current index and last processed time
//     searchSession.currentIndex = nextIndex + 1
//     searchSession.lastProcessedTime = Date.now()
//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

//     console.log(`🔄 Processing URL ${nextIndex + 1}/${urls.length}: ${nextUrl}`)
//     console.log(`📈 Progress: ${totalCompleted} completed, ${searchSession.consecutiveErrors} consecutive errors`)
    
//     await updateBadge(`${totalCompleted + 1}/${urls.length}`)

//     // Process the URL with enhanced error handling
//     await processUrlSequentiallyWithRecovery(searchId, nextUrl, nextIndex)
    
//   } catch (error) {
//     console.error(`❌ Critical error in sequential processing for search ${searchId}:`, error)
    
//     // Attempt to recover by moving to next URL
//     try {
//       await markUrlProcessedAndContinue(searchId, "unknown-error-url", true)
//     } catch (recoveryError) {
//       console.error(`❌ Recovery failed, finishing search:`, recoveryError)
//       await finishSearch(searchId)
//     }
//   }
// }

// // UPDATED: Enhanced URL processing with new active tab creation
// async function processUrlSequentiallyWithRecovery(searchId, url, urlIndex) {
//   const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//   const searchSession = searches.get(searchId)

//   if (!searchSession) {
//     console.error(`❌ Search session ${searchId} not found`)
//     return
//   }

//   try {
//     console.log(`🆕 Creating new active tab for ${url}... (Consecutive errors: ${searchSession.consecutiveErrors})`)

//     // Add progressive delay based on consecutive errors
//     const errorDelay = Math.min(searchSession.consecutiveErrors * 2000, 10000)
//     const baseDelay = TAB_CREATION_DELAY + errorDelay
    
//     await new Promise((resolve) => setTimeout(resolve, baseDelay))

//     // CHANGED: Create new active tab instead of using existing tab
//     let tab
//     try {
//       tab = await chrome.tabs.create({
//         url: url,
//         active: true, // CHANGED: Make tab active/visible for proper DOM rendering
//         pinned: false,
//       })
//       console.log(`✅ Created new active tab ${tab.id} for ${url}`)
//     } catch (tabError) {
//       console.error(`❌ Failed to create tab for ${url}:`, tabError)
//       await handleUrlError(searchId, url, `Tab creation failed: ${tabError.message}`)
//       return
//     }

//     // Enhanced extraction management
//     const extraction = {
//       url,
//       tabId: tab.id,  // CHANGED: Use new tab.id
//       startTime: Date.now(),
//       timeout: null,
//       loadTimeout: null,
//       urlIndex
//     }

//     searchSession.activeExtractions = searchSession.activeExtractions || []
//     searchSession.activeExtractions.push(extraction)

//     // Enhanced tab loading detection with better error handling
//     let tabLoaded = false
//     let injectionAttempted = false
//     let loadCheckCount = 0
//     const maxLoadChecks = 25 // Increased for active tab

//     const tabUpdateListener = (tabId, changeInfo, updatedTab) => {
//       if (tabId === tab.id && !injectionAttempted) {  // CHANGED: Use tab.id
//         console.log(`Tab ${tab.id} update:`, changeInfo)

//         // Handle various completion states
//         if (changeInfo.status === "complete" || 
//             (changeInfo.url && changeInfo.url.includes("linkedin.com/in/"))) {
          
//           injectionAttempted = true
//           tabLoaded = true
//           chrome.tabs.onUpdated.removeListener(tabUpdateListener)

//           if (extraction.loadTimeout) {
//             clearTimeout(extraction.loadTimeout)
//           }

//           console.log(`🔄 Tab ${tab.id} loaded, injecting extraction script...`)

//           // Longer wait for LinkedIn to fully render
//           setTimeout(() => {
//             chrome.tabs
//               .sendMessage(tab.id, {
//                 action: "setSearchContext",
//                 searchId: searchId,
//                 backendUrl: searchSession.backendUrl,
//               })
//               .then(() => {
//                 console.log(`✅ Successfully injected script into tab ${tab.id}`)
//               })
//               .catch((error) => {
//                 console.error(`❌ Error injecting script into tab ${tab.id}:`, error)
//                 // Auto-continue to next URL on injection error
//                 setTimeout(() => handleUrlError(searchId, url, `Script injection failed: ${error.message}`), 1000)
//               })
//           }, 5000) // Increased wait time for active tab
//         }
//       }
//     }

//     chrome.tabs.onUpdated.addListener(tabUpdateListener)

//     // Enhanced load timeout with auto-progression
//     const checkTabLoading = async () => {
//       loadCheckCount++
      
//       try {
//         // Check if tab still exists and is on LinkedIn
//         const currentTab = await chrome.tabs.get(tab.id)  // CHANGED
        
//         console.log(`Checking tab ${tab.id} loading status: ${loadCheckCount}/${maxLoadChecks}`)

//         if (loadCheckCount >= maxLoadChecks && !injectionAttempted) {
//           injectionAttempted = true
//           chrome.tabs.onUpdated.removeListener(tabUpdateListener)
//           console.log(`⏰ Tab ${tab.id} loading timeout, attempting injection anyway...`)

//           try {
//             await chrome.tabs.sendMessage(tab.id, {
//               action: "setSearchContext",
//               searchId: searchId,
//               backendUrl: searchSession.backendUrl,
//             })
//             console.log(`✅ Timeout injection successful for tab ${tab.id}`)
//           } catch (injectionError) {
//             console.error(`❌ Timeout injection failed for tab ${tab.id}:`, injectionError)
//             // CHANGED: Auto-continue to next URL instead of stopping
//             await handleUrlError(searchId, url, `Loading timeout and injection failed: ${injectionError.message}`)
//           }
//         } else if (!injectionAttempted) {
//           extraction.loadTimeout = setTimeout(checkTabLoading, 1500) // Slightly longer for active tab
//         }
//       } catch (tabError) {
//         console.error(`❌ Tab ${tab.id} error during loading check:`, tabError)
//         chrome.tabs.onUpdated.removeListener(tabUpdateListener)
//         // CHANGED: Auto-continue instead of stopping
//         await handleUrlError(searchId, url, `Tab became invalid: ${tabError.message}`)
//       }
//     }

//     extraction.loadTimeout = setTimeout(checkTabLoading, 1500)

//     // CHANGED: Reduced extraction timeout for active tab and auto-continue
//     extraction.timeout = setTimeout(async () => {
//       console.log(`⏰ Extraction timeout for ${url} (tab ${tab.id})`)
//       await handleExtractionTimeout(searchId, url, tab.id)  // CHANGED
//     }, 35000) // Reduced timeout for active tab

//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

//   } catch (error) {
//     console.error(`❌ Error processing URL ${url}:`, error)
//     // CHANGED: Always continue to next URL
//     await handleUrlError(searchId, url, `Processing error: ${error.message}`)
//   }
// }

// // UPDATED: Enhanced error handling with guaranteed progression
// async function handleUrlError(searchId, url, errorMessage) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (searchSession) {
//       searchSession.consecutiveErrors++
//       searchSession.totalErrors++
      
//       console.log(`❌ URL Error for ${url}: ${errorMessage} (Consecutive: ${searchSession.consecutiveErrors})`)

//       // Clean up any active extractions for this URL
//       if (searchSession.activeExtractions) {
//         // Clear timeouts and remove extraction
//         searchSession.activeExtractions = searchSession.activeExtractions.filter(ext => {
//           if (ext.url === url) {
//             if (ext.timeout) clearTimeout(ext.timeout)
//             if (ext.loadTimeout) clearTimeout(ext.loadTimeout)
//             return false
//           }
//           return true
//         })
//       }

//       // Send error to backend
//       try {
//         await sendToBackend(
//           searchSession.backendUrl,
//           {
//             searchId,
//             profileUrl: url,
//             success: false,
//             error: errorMessage,
//             extractionMethod: "new-active-tab-error",
//             consecutiveErrors: searchSession.consecutiveErrors,
//             totalErrors: searchSession.totalErrors
//           },
//           "/api/headhunter/process-linkedin-dom",
//         )
//       } catch (backendError) {
//         console.warn(`⚠️ Failed to send error to backend:`, backendError.message)
//       }

//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     }

//     // GUARANTEED: Always continue to next URL regardless of error
//     console.log(`🔄 FORCING continuation to next URL after error: ${errorMessage}`)
//     await markUrlProcessedAndContinue(searchId, url, true)
    
//   } catch (error) {
//     console.error(`❌ Critical error in handleUrlError, FORCE continuing:`, error)
//     // ULTIMATE FALLBACK: Force continue even if everything fails
//     setTimeout(() => {
//       console.log(`🚀 EMERGENCY continuation for search ${searchId}`)
//       processSequentially(searchId)
//     }, QUEUE_ADVANCE_DELAY)
//   }
// }

// // UPDATED: Enhanced extraction completion handling with tab cleanup
// async function handleExtractionComplete(request, tabId) {
//   try {
//     const { searchId, profileUrl, url } = request
//     const finalUrl = profileUrl || url

//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (searchSession) {
//       // Reset consecutive errors on success
//       if (request.success) {
//         searchSession.consecutiveErrors = 0
//       } else {
//         searchSession.consecutiveErrors++
//         searchSession.totalErrors++
//       }

//       // Clean up active extractions
//       if (searchSession.activeExtractions) {
//         const extractionIndex = searchSession.activeExtractions.findIndex(
//           (extraction) => extraction.tabId === tabId || extraction.url === finalUrl
//         )

//         if (extractionIndex !== -1) {
//           const extraction = searchSession.activeExtractions[extractionIndex]
//           if (extraction.timeout) clearTimeout(extraction.timeout)
//           if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
//           searchSession.activeExtractions.splice(extractionIndex, 1)
//           console.log(`✅ Cleared extraction for ${finalUrl}`)
//         }
//       }

//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     }

//     // Send to backend
//     try {
//       await sendToBackend(
//         request.backendUrl || BACKEND_URL,
//         {
//           ...request,
//           profileUrl: finalUrl,
//         },
//         "/api/headhunter/process-linkedin-dom",
//       )
//     } catch (backendError) {
//       console.warn(`⚠️ Failed to send success to backend:`, backendError.message)
//     }

//     // CHANGED: Close the completed tab after short delay
//     setTimeout(async () => {
//       if (tabId) {
//         try {
//           await chrome.tabs.remove(tabId)
//           console.log(`🗑️ Closed completed tab ${tabId}`)
//         } catch (error) {
//           console.warn(`⚠️ Could not close completed tab ${tabId}:`, error.message)
//         }
//       }
//     }, 2000) // 2 second delay to show completion

//     console.log(`✅ Extraction completed for ${finalUrl}`)

//     // CHANGED: Always continue to next URL
//     console.log(`🔄 Auto-continuing to next URL after successful extraction...`)
//     await markUrlProcessedAndContinue(searchId, finalUrl, false)
    
//   } catch (error) {
//     console.error("❌ Error handling extraction completion, forcing continuation:", error)
//     // CHANGED: Force continue even if completion handling fails
//     const finalUrl = request.profileUrl || request.url || "unknown-url"
    
//     // Still try to close the tab
//     setTimeout(async () => {
//       try {
//         await chrome.tabs.remove(tabId)
//         console.log(`🗑️ Closed tab ${tabId} after error`)
//       } catch (tabError) {
//         console.warn(`⚠️ Could not close tab ${tabId}:`, tabError.message)
//       }
//     }, 1000)
    
//     setTimeout(() => {
//       markUrlProcessedAndContinue(searchId, finalUrl, true)
//     }, 1000)
//   }
// }

// // ADDED: handleExtractionTimeout function with tab cleanup
// async function handleExtractionTimeout(searchId, url, tabId) {
//   try {
//     console.log(`⏰ Handling extraction timeout for ${url} (tab ${tabId})`)
    
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (searchSession && searchSession.activeExtractions) {
//       const extractionIndex = searchSession.activeExtractions.findIndex(
//         (extraction) => extraction.tabId === tabId
//       )

//       if (extractionIndex !== -1) {
//         const extraction = searchSession.activeExtractions[extractionIndex]
//         if (extraction.timeout) clearTimeout(extraction.timeout)
//         if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
//         searchSession.activeExtractions.splice(extractionIndex, 1)
//       }

//       searchSession.consecutiveErrors++
//       searchSession.totalErrors++
//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     }

//     // Close the timed-out tab
//     if (tabId) {
//       try {
//         await chrome.tabs.remove(tabId)
//         console.log(`🗑️ Closed timed-out tab ${tabId}`)
//       } catch (error) {
//         console.warn(`⚠️ Could not close timed-out tab ${tabId}:`, error.message)
//       }
//     }

//     // Send timeout error to backend
//     if (searchSession) {
//       try {
//         await sendToBackend(
//           searchSession.backendUrl,
//           {
//             searchId,
//             profileUrl: url,
//             success: false,
//             error: "Extraction timeout - page may be blocked or slow to load",
//             extractionMethod: "new-active-tab-timeout",
//             consecutiveErrors: searchSession.consecutiveErrors,
//             totalErrors: searchSession.totalErrors
//           },
//           "/api/headhunter/process-linkedin-dom",
//         )
//       } catch (backendError) {
//         console.warn(`⚠️ Failed to send timeout to backend:`, backendError.message)
//       }
//     }

//     // Continue to next URL
//     await markUrlProcessedAndContinue(searchId, url, true)
    
//   } catch (error) {
//     console.error("❌ Error handling timeout:", error)
//     // Force continue
//     setTimeout(() => processSequentially(searchId), QUEUE_ADVANCE_DELAY)
//   }
// }

// // UPDATED: Enhanced continuation with triple fail-safe
// async function markUrlProcessedAndContinue(searchId, url, isError = false) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (searchSession) {
//       // Ensure completedUrls is a Set
//       if (!(searchSession.completedUrls instanceof Set)) {
//         searchSession.completedUrls = new Set(searchSession.completedUrls || [])
//       }

//       searchSession.completedUrls.add(url)
//       searchSession.lastProcessedTime = Date.now()
      
//       // Reset consecutive errors on successful processing
//       if (!isError) {
//         searchSession.consecutiveErrors = 0
//       }

//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

//       const progress = `${searchSession.completedUrls.size}/${searchSession.urls.length}`
//       console.log(`✅ Marked ${url} as ${isError ? 'failed' : 'completed'}. Progress: ${progress}`)
//     }

//     // FAIL-SAFE 1: Normal continuation
//     const delay = isError ? Math.min(QUEUE_ADVANCE_DELAY + 2000, 6000) : QUEUE_ADVANCE_DELAY
//     console.log(`🔄 Continuing to next URL in ${delay}ms...`)
    
//     setTimeout(() => {
//       console.log(`🚀 Processing next URL for search ${searchId}...`)
//       processSequentially(searchId)
//     }, delay)

//     // FAIL-SAFE 2: Backup continuation in case first one fails
//     setTimeout(() => {
//       console.log(`🛡️ Backup continuation check for search ${searchId}...`)
//       processSequentially(searchId)
//     }, delay + 10000) // 10 seconds later

//     // FAIL-SAFE 3: Emergency continuation
//     setTimeout(() => {
//       console.log(`🚨 Emergency continuation for search ${searchId}...`)
//       processSequentially(searchId)
//     }, delay + 30000) // 30 seconds later
    
//   } catch (error) {
//     console.error(`❌ Error marking URL as processed, activating emergency protocols:`, error)
    
//     // EMERGENCY: Multiple continuation attempts
//     for (let i = 1; i <= 3; i++) {
//       setTimeout(() => {
//         console.log(`🚨 Emergency continuation attempt ${i}/3 for search ${searchId}`)
//         processSequentially(searchId)
//       }, i * QUEUE_ADVANCE_DELAY)
//     }
//   }
// }

// // Enhanced stop search handling
// async function handleStopSearch(request) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(request.searchId)
//     if (searchSession) {
//       searchSession.isStopping = true
//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
      
//       // Clean up any active extractions
//       if (searchSession.activeExtractions) {
//         for (const extraction of searchSession.activeExtractions) {
//           try {
//             if (extraction.timeout) clearTimeout(extraction.timeout)
//             if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
//             await chrome.tabs.remove(extraction.tabId)
//           } catch (error) {
//             console.warn(`⚠️ Error cleaning up extraction:`, error)
//           }
//         }
//       }
      
//       return { success: true, message: "Search stop requested" }
//     }
//     return { success: false, message: "Search not found" }
//   } catch (error) {
//     console.error("❌ Error stopping search:", error)
//     return { success: false, error: error.message }
//   }
// }

// async function handleGetActiveSearches() {
//   try {
//     const searches = await getStorage(SEARCHES_STORAGE_KEY)
//     return { searches: Object.keys(searches) }
//   } catch (error) {
//     console.error("❌ Error getting active searches:", error)
//     return { searches: [] }
//   }
// }

// async function finishSearch(searchId) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     console.log(`🏁 Finishing search ${searchId}`)

//     // Close any remaining active tabs
//     if (searchSession && searchSession.activeExtractions) {
//       for (const extraction of searchSession.activeExtractions) {
//         try {
//           await chrome.tabs.remove(extraction.tabId)
//           if (extraction.timeout) clearTimeout(extraction.timeout)
//           if (extraction.loadTimeout) clearTimeout(extraction.loadTimeout)
//         } catch (error) {
//           console.warn("⚠️ Error closing remaining tab:", error)
//         }
//       }
//     }

//     // Log final statistics
//     if (searchSession) {
//       const completed = searchSession.completedUrls ? searchSession.completedUrls.size : 0
//       const total = searchSession.urls ? searchSession.urls.length : 0
//       const errors = searchSession.totalErrors || 0
//       const duration = Date.now() - searchSession.startTime
      
//       console.log(`📊 Search ${searchId} Final Stats:`)
//       console.log(`   Completed: ${completed}/${total}`)
//       console.log(`   Total Errors: ${errors}`)
//       console.log(`   Duration: ${Math.round(duration / 1000)}s`)
//     }

//     searches.delete(searchId)
//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

//     if (searches.size === 0) {
//       await clearBadge()
//     }
//   } catch (error) {
//     console.error(`❌ Error finishing search:`, error)
//   }
// }

// // Enhanced backend communication with retry logic
// async function sendToBackend(backendUrl, data, endpointPath, retries = 3) {
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       const fullUrl = `${backendUrl}${endpointPath}`
//       console.log(`📤 Sending to backend (attempt ${attempt}): ${data.success ? "SUCCESS" : "FAILED"} for ${data.profileUrl || data.url}`)

//       const response = await fetch(fullUrl, {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           "User-Agent": "Bloomix-Extension/1.0",
//         },
//         body: JSON.stringify(data),
//       })

//       if (!response.ok) {
//         throw new Error(`Backend responded with status ${response.status}`)
//       }

//       const result = await response.json()
//       console.log(`📥 Backend response: ${result.success ? "SUCCESS" : "FAILED"}`)
//       return result
      
//     } catch (error) {
//       console.error(`❌ Backend error (attempt ${attempt}/${retries}):`, error)
//       if (attempt === retries) {
//         console.error(`❌ Final backend failure for ${data.profileUrl || data.url}`)
//       } else {
//         await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
//       }
//     }
//   }
// }

// console.log("🎉 Bloomix Extractor: Enhanced background service worker initialized")

// ---------- working code but stuck in middle --------
// // background.js - Fixed version with sequential processing
// const BACKEND_URL = "http://localhost:5000/v1"
// const SEARCHES_STORAGE_KEY = "activeSearches"
// const EXTRACTION_TIMEOUT = 45000 // Increased to 45 seconds
// const TAB_LOAD_TIMEOUT = 15000 // Increased to 15 seconds
// const MAX_CONCURRENT_TABS = 1 // Changed to 1 for sequential processing
// const QUEUE_ADVANCE_DELAY = 3000 // Increased delay between tabs
// const TAB_CREATION_DELAY = 2000 // New: delay between tab creations

// // const chrome = window.chrome // Declare the chrome variable

// console.log("🚀 Bloomix Extractor: Fixed sequential background script starting...")

// // Storage functions with Set conversion
// async function getStorage(key) {
//   try {
//     const result = await chrome.storage.session.get(key)
//     const data = result[key] || {}

//     // Convert completedUrls arrays back to Sets
//     for (const searchId in data) {
//       if (data[searchId].completedUrls) {
//         if (Array.isArray(data[searchId].completedUrls)) {
//           data[searchId].completedUrls = new Set(data[searchId].completedUrls)
//         } else {
//           data[searchId].completedUrls = new Set()
//         }
//       }
//     }

//     return data
//   } catch (error) {
//     console.error(`❌ Error getting storage for ${key}:`, error)
//     return {}
//   }
// }

// async function setStorage(key, value) {
//   try {
//     // Convert Sets to arrays for storage
//     const storageData = {}
//     for (const searchId in value) {
//       storageData[searchId] = { ...value[searchId] }
//       if (storageData[searchId].completedUrls instanceof Set) {
//         storageData[searchId].completedUrls = Array.from(storageData[searchId].completedUrls)
//       }
//     }

//     await chrome.storage.session.set({ [key]: storageData })
//     console.log(`✅ Storage set for ${key}`)
//   } catch (error) {
//     console.error(`❌ Error setting storage for ${key}:`, error)
//   }
// }

// // Badge management
// async function updateBadge(text) {
//   try {
//     await chrome.action.setBadgeText({ text })
//     await chrome.action.setBadgeBackgroundColor({ color: "#007bff" })
//   } catch (error) {
//     console.error("❌ Error updating badge:", error)
//   }
// }

// async function clearBadge() {
//   try {
//     await chrome.action.setBadgeText({ text: "" })
//   } catch (error) {
//     console.error("❌ Error clearing badge:", error)
//   }
// }

// // Initialize
// chrome.runtime.onInstalled.addListener(() => {
//   console.log("🔧 Bloomix Extractor: Extension installed/updated")
//   setStorage(SEARCHES_STORAGE_KEY, {})
//   clearBadge()
// })

// chrome.runtime.onStartup.addListener(async () => {
//   console.log("🔧 Bloomix Extractor: Service worker startup")
//   await setStorage(SEARCHES_STORAGE_KEY, {})
//   await clearBadge()
// })

// // Message handling
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   console.log("📨 Background received message:", {
//     action: request.action,
//     from: sender.tab?.id || sender.documentId || "unknown",
//     hasSearchId: !!request.searchId,
//   })

//   if (request.action === "keepAlive") {
//     sendResponse({ success: true, message: "Service worker alive" })
//     return true
//   }

//   const handleAsync = async () => {
//     try {
//       let result
//       switch (request.action) {
//         case "startSearch":
//           console.log("🚀 Starting search:", request.searchId)
//           result = await handleStartSearch(request)
//           break
//         case "stopSearch":
//           console.log("🛑 Stopping search:", request.searchId)
//           result = await handleStopSearch(request)
//           break
//         case "getActiveSearches":
//           result = await handleGetActiveSearches()
//           break
//         case "ping":
//           result = { success: true, message: "Extension connected" }
//           break
//         case "extractionComplete":
//           console.log("✅ Extraction completion received:", {
//             success: request.success,
//             profileUrl: request.profileUrl || request.url,
//             searchId: request.searchId,
//             tabId: sender.tab?.id,
//           })

//           if (request.searchId) {
//             await handleExtractionComplete(request, sender.tab?.id)
//           } else {
//             await sendToBackend(
//               request.backendUrl || BACKEND_URL,
//               {
//                 ...request,
//                 profileUrl: request.profileUrl || request.url,
//               },
//               "/api/headhunter/process-linkedin-dom",
//             )
//           }

//           result = { success: true, message: "Extraction processed" }
//           break
//         case "extractData":
//           return false
//         default:
//           result = { success: false, error: "Unknown action" }
//       }
//       sendResponse(result)
//     } catch (error) {
//       console.error(`❌ Error handling ${request.action}:`, error)
//       sendResponse({ success: false, error: error.message })
//     }
//   }
//   handleAsync()
//   return true
// })

// // Enhanced search handling with sequential processing
// async function handleStartSearch(request) {
//   try {
//     console.log("🔍 handleStartSearch called with:", {
//       searchId: request.searchId,
//       urlCount: request.urls?.length,
//     })

//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const { searchId, urls, backendUrl } = request

//     if (!searchId || !urls || !Array.isArray(urls)) {
//       throw new Error("Invalid search parameters")
//     }

//     // CRITICAL FIX: Always start with a clean slate for the search session
//     console.log(`Initializing a fresh search session for ${searchId}. Any previous session data for this ID will be overwritten.`);
    
//     const linkedinUrls = urls.filter((url) => url && url.includes("linkedin.com/in/"))
//     console.log(`📊 Filtered URLs: ${linkedinUrls.length} LinkedIn profiles`)

//     // Overwrite any existing search to ensure it's a fresh start
//     searches.set(searchId, {
//       searchId,
//       backendUrl: backendUrl || BACKEND_URL,
//       urls: linkedinUrls,
//       processedCount: 0,
//       completedUrls: new Set(),
//       isStopping: false,
//       startTime: Date.now(),
//       activeExtractions: [],
//       currentIndex: 0,
//     })

//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     console.log(`✅ Search ${searchId} stored with ${linkedinUrls.length} URLs`)

//     // Start sequential processing
//     setTimeout(() => processSequentially(searchId), 2000)

//     return { success: true, message: "Search started successfully" }
//   } catch (error) {
//     console.error("❌ Error starting search:", error)
//     return { success: false, error: error.message }
//   }
// }

// // New sequential processing function
// async function processSequentially(searchId) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (!searchSession || searchSession.isStopping) {
//       console.log(`❌ Search ${searchId} not found or stopping`)
//       await finishSearch(searchId)
//       return
//     }

//     const { urls, completedUrls, currentIndex } = searchSession

//     // Ensure completedUrls is a Set
//     if (!(completedUrls instanceof Set)) {
//       searchSession.completedUrls = new Set(completedUrls || [])
//     }

//     const totalCompleted = searchSession.completedUrls.size

//     // Check if we're done
//     if (totalCompleted >= urls.length || currentIndex >= urls.length) {
//       console.log(`✅ All URLs completed for search ${searchId}`)
//       await finishSearch(searchId)
//       return
//     }

//     // Find next URL to process
//     let nextUrl = null
//     let nextIndex = currentIndex

//     for (let i = currentIndex; i < urls.length; i++) {
//       const url = urls[i]
//       if (!searchSession.completedUrls.has(url)) {
//         nextUrl = url
//         nextIndex = i
//         break
//       }
//     }

//     if (!nextUrl) {
//       console.log(`✅ No more URLs to process for search ${searchId}`)
//       await finishSearch(searchId)
//       return
//     }

//     // Update current index
//     searchSession.currentIndex = nextIndex + 1
//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

//     console.log(`🔄 Processing URL ${nextIndex + 1}/${urls.length}: ${nextUrl}`)
//     await updateBadge(`${totalCompleted + 1}/${urls.length}`)

//     // Process the URL
//     await processUrlSequentially(searchId, nextUrl)
//   } catch (error) {
//     console.error(`❌ Error in sequential processing for search ${searchId}:`, error)
//     await finishSearch(searchId)
//   }
// }

// // Process individual URL sequentially
// async function processUrlSequentially(searchId, url) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (!searchSession) return

//     console.log(`🆕 Creating tab for ${url}...`)

//     // Add delay before creating tab to avoid overwhelming LinkedIn
//     await new Promise((resolve) => setTimeout(resolve, TAB_CREATION_DELAY))

//     const tab = await chrome.tabs.create({
//       url: url,
//       active: true, // Make the tab active
//       pinned: false,
//     });

//     // Focus the window to ensure the tab is visible
//     await chrome.windows.update(tab.windowId, { focused: true });

//     console.log(`✅ Created tab ${tab.id} for ${url}`)

//     // Add to active extractions
//     const extraction = {
//       url,
//       tabId: tab.id,
//       startTime: Date.now(),
//       timeout: null,
//       loadTimeout: null,
//     }

//     searchSession.activeExtractions = searchSession.activeExtractions || []
//     searchSession.activeExtractions.push(extraction)

//     // Enhanced tab loading detection
//     let tabLoaded = false
//     let injectionAttempted = false
//     let loadCheckCount = 0
//     const maxLoadChecks = 15 // 15 seconds max for loading

//     const tabUpdateListener = (tabId, changeInfo, updatedTab) => {
//       if (tabId === tab.id) {
//         console.log(`Tab ${tab.id} update:`, changeInfo)

//         if (changeInfo.status === "complete" && !injectionAttempted) {
//           injectionAttempted = true
//           tabLoaded = true
//           chrome.tabs.onUpdated.removeListener(tabUpdateListener)

//           if (extraction.loadTimeout) {
//             clearTimeout(extraction.loadTimeout)
//           }

//           console.log(`📄 Tab ${tab.id} loaded, waiting before injection...`)

//           // Additional wait for LinkedIn to fully render
//           setTimeout(() => {
//             chrome.tabs
//               .sendMessage(tab.id, {
//                 action: "setSearchContext",
//                 searchId: searchId,
//                 backendUrl: searchSession.backendUrl,
//               })
//               .catch((error) => {
//                 console.error("❌ Error setting search context:", error)
//               })
//           }, 3000) // Wait 3 seconds after page load
//         }
//       }
//     }

//     chrome.tabs.onUpdated.addListener(tabUpdateListener)

//     // Enhanced load timeout with periodic checks
//     const checkTabLoading = () => {
//       loadCheckCount++
//       console.log(`Checking tab ${tab.id} loading status: ${loadCheckCount}/${maxLoadChecks}`)

//       if (loadCheckCount >= maxLoadChecks && !injectionAttempted) {
//         injectionAttempted = true
//         chrome.tabs.onUpdated.removeListener(tabUpdateListener)
//         console.log(`⏰ Tab ${tab.id} loading timeout, attempting injection anyway...`)

//         chrome.tabs
//           .sendMessage(tab.id, {
//             action: "setSearchContext",
//             searchId: searchId,
//             backendUrl: searchSession.backendUrl,
//           })
//           .catch((error) => {
//             console.error("❌ Error setting search context after timeout:", error)
//           })
//       } else if (!injectionAttempted) {
//         extraction.loadTimeout = setTimeout(checkTabLoading, 1000)
//       }
//     }

//     extraction.loadTimeout = setTimeout(checkTabLoading, 1000)

//     // Extraction timeout
//     extraction.timeout = setTimeout(async () => {
//       console.log(`⏰ Tab extraction timeout for ${url}`)
//       await handleExtractionTimeout(searchId, url, tab.id)
//     }, EXTRACTION_TIMEOUT)

//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//   } catch (error) {
//     console.error(`❌ Error processing URL ${url}:`, error)
//     await sendToBackend(
//       BACKEND_URL,
//       {
//         searchId,
//         profileUrl: url,
//         success: false,
//         error: `Tab creation failed: ${error.message}`,
//         extractionMethod: "sequential-tab-failed",
//       },
//       "/api/headhunter/process-linkedin-dom",
//     )

//     await markUrlProcessedAndContinue(searchId, url)
//   }
// }

// // Handle extraction completion
// async function handleExtractionComplete(request, tabId) {
//   try {
//     const { searchId, profileUrl, url } = request
//     const finalUrl = profileUrl || url

//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (searchSession && searchSession.activeExtractions) {
//       // Remove from active extractions
//       const extractionIndex = searchSession.activeExtractions.findIndex((extraction) => extraction.tabId === tabId)

//       if (extractionIndex !== -1) {
//         const extraction = searchSession.activeExtractions[extractionIndex]
//         if (extraction.timeout) {
//           clearTimeout(extraction.timeout)
//         }
//         if (extraction.loadTimeout) {
//           clearTimeout(extraction.loadTimeout)
//         }
//         searchSession.activeExtractions.splice(extractionIndex, 1)

//         console.log(`✅ Cleared extraction for ${finalUrl}`)
//       }

//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     }

//     // Close the tab
//     if (tabId) {
//       try {
//         await chrome.tabs.remove(tabId)
//         console.log(`🗑️ Closed tab ${tabId}`)
//       } catch (error) {
//         console.error("❌ Error closing tab:", error)
//       }
//     }

//     // Send to backend
//     await sendToBackend(
//       request.backendUrl || BACKEND_URL,
//       {
//         ...request,
//         profileUrl: finalUrl,
//       },
//       "/api/headhunter/process-linkedin-dom",
//     )

//     // Mark as processed and continue with next URL
//     await markUrlProcessedAndContinue(searchId, finalUrl)
//   } catch (error) {
//     console.error("❌ Error handling extraction completion:", error)
//   }
// }

// // Mark URL as processed and continue sequential processing
// async function markUrlProcessedAndContinue(searchId, url) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (searchSession) {
//       // Ensure completedUrls is a Set
//       if (!(searchSession.completedUrls instanceof Set)) {
//         searchSession.completedUrls = new Set(searchSession.completedUrls || [])
//       }

//       searchSession.completedUrls.add(url)
//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))

//       console.log(
//         `✅ Marked ${url} as completed. Total: ${searchSession.completedUrls.size}/${searchSession.urls.length}`,
//       )

//       // Continue with next URL after delay
//       setTimeout(() => processSequentially(searchId), QUEUE_ADVANCE_DELAY)
//     }
//   } catch (error) {
//     console.error(`❌ Error marking URL as processed:`, error)
//   }
// }

// // Handle timeout
// async function handleExtractionTimeout(searchId, url, tabId) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     if (searchSession && searchSession.activeExtractions) {
//       const extractionIndex = searchSession.activeExtractions.findIndex((extraction) => extraction.tabId === tabId)

//       if (extractionIndex !== -1) {
//         const extraction = searchSession.activeExtractions[extractionIndex]
//         if (extraction.timeout) {
//           clearTimeout(extraction.timeout)
//         }
//         if (extraction.loadTimeout) {
//           clearTimeout(extraction.loadTimeout)
//         }
//         searchSession.activeExtractions.splice(extractionIndex, 1)
//       }

//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     }

//     // Close the tab
//     if (tabId) {
//       try {
//         await chrome.tabs.remove(tabId)
//         console.log(`🗑️ Closed timed-out tab ${tabId}`)
//       } catch (error) {
//         console.error("❌ Error closing timed-out tab:", error)
//       }
//     }

//     if (searchSession) {
//       await sendToBackend(
//         searchSession.backendUrl,
//         {
//           searchId,
//           profileUrl: url,
//           success: false,
//           error: "Sequential tab extraction timeout - LinkedIn may be blocking or page failed to load",
//           extractionMethod: "sequential-tab-timeout",
//         },
//         "/api/headhunter/process-linkedin-dom",
//       )

//       await markUrlProcessedAndContinue(searchId, url)
//     }
//   } catch (error) {
//     console.error("❌ Error handling timeout:", error)
//   }
// }

// // Other functions remain the same
// async function handleStopSearch(request) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(request.searchId)
//     if (searchSession) {
//       searchSession.isStopping = true
//       await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//       return { success: true, message: "Search stop requested" }
//     }
//     return { success: false, message: "Search not found" }
//   } catch (error) {
//     console.error("❌ Error stopping search:", error)
//     return { success: false, error: error.message }
//   }
// }

// async function handleGetActiveSearches() {
//   try {
//     const searches = await getStorage(SEARCHES_STORAGE_KEY)
//     return { searches: Object.keys(searches) }
//   } catch (error) {
//     console.error("❌ Error getting active searches:", error)
//     return { searches: [] }
//   }
// }

// async function finishSearch(searchId) {
//   try {
//     const searches = new Map(Object.entries(await getStorage(SEARCHES_STORAGE_KEY)))
//     const searchSession = searches.get(searchId)

//     // Close any remaining active tabs
//     if (searchSession && searchSession.activeExtractions) {
//       for (const extraction of searchSession.activeExtractions) {
//         try {
//           await chrome.tabs.remove(extraction.tabId)
//           if (extraction.timeout) {
//             clearTimeout(extraction.timeout)
//           }
//           if (extraction.loadTimeout) {
//             clearTimeout(extraction.loadTimeout)
//           }
//         } catch (error) {
//           console.error("❌ Error closing remaining tab:", error)
//         }
//       }
//     }

//     searches.delete(searchId)
//     await setStorage(SEARCHES_STORAGE_KEY, Object.fromEntries(searches))
//     console.log(`🏁 Search ${searchId} finished`)

//     if (searches.size === 0) {
//       await clearBadge()
//     }
//   } catch (error) {
//     console.error(`❌ Error finishing search:`, error)
//   }
// }

// // Backend communication
// async function sendToBackend(backendUrl, data, endpointPath) {
//   try {
//     const fullUrl = `${backendUrl}${endpointPath}`
//     console.log(`📤 Sending to backend: ${data.success ? "SUCCESS" : "FAILED"} for ${data.profileUrl || data.url}`)

//     const response = await fetch(fullUrl, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "User-Agent": "Bloomix-Extension/1.0",
//       },
//       body: JSON.stringify(data),
//     })

//     if (!response.ok) {
//       throw new Error(`Backend responded with status ${response.status}`)
//     }

//     const result = await response.json()
//     console.log(`📥 Backend response: ${result.success ? "SUCCESS" : "FAILED"}`)
//   } catch (error) {
//     console.error("❌ Error sending data to backend:", error)
//   }
// }

// console.log("🎉 Bloomix Extractor: Sequential background service worker initialized")
