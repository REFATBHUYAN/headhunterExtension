
// content.js - Enhanced version with better error handling and recovery

let extractionAttempted = false;
let retryCount = 0;
const MAX_RETRIES = 3; // Increased retries
const RETRY_DELAY = 5000;
const LINKEDIN_LOAD_WAIT = 10000; // Increased wait time
const MAX_WAIT_FOR_ELEMENTS = 30000; // Maximum time to wait for elements

const searchContext = {
  searchId: null,
  backendUrl: null,
  isBackgroundTab: false,
};

console.log("Bloomix Extractor: Enhanced content script loaded on:", window.location.href);

// Enhanced message listener with better error handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("📩 Content script received message:", request.action);
  
  try {
    if (request.action === "setSearchContext") {
      searchContext.searchId = request.searchId;
      searchContext.backendUrl = request.backendUrl;
      searchContext.isBackgroundTab = true;
      
      console.log("Bloomix Extractor: Search context set for background tab:", {
        searchId: searchContext.searchId,
        url: window.location.href,
        isLinkedIn: isLinkedInProfilePage()
      });
      
      if (isLinkedInProfilePage()) {
        console.log("Bloomix Extractor: Starting background tab extraction...");
        setTimeout(initializeExtraction, LINKEDIN_LOAD_WAIT);
      } else {
        console.warn("Bloomix Extractor: Not on LinkedIn profile page:", window.location.href);
        // Send error message back
        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: "extractionComplete",
            success: false,
            error: "Not a LinkedIn profile page",
            profileUrl: window.location.href,
            searchId: searchContext.searchId,
            backendUrl: searchContext.backendUrl
          });
        }, 1000);
      }
      
      sendResponse({ success: true });
      return true;
    }

    if (request.action === "extractData") {
      searchContext.isBackgroundTab = false;
      performExtraction()
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          console.error("❌ Manual extraction failed:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
  } catch (error) {
    console.error("❌ Error in message listener:", error);
    sendResponse({ success: false, error: error.message });
  }
});

function isLinkedInProfilePage() {
  const url = window.location.href;
  const isLinkedIn = url.includes("linkedin.com/in/");
  console.log("🔍 Checking if LinkedIn profile page:", { url, isLinkedIn });
  return isLinkedIn;
}

/**
 * Enhanced function to wait for elements to appear with timeout
 */
async function waitForElement(selector, timeout = MAX_WAIT_FOR_ELEMENTS) {
  console.log(`⏳ Waiting for element: ${selector}`);
  
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      console.log(`✅ Element found immediately: ${selector}`);
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`✅ Element found after waiting: ${selector}`);
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      console.log(`⏰ Timeout waiting for element: ${selector}`);
      resolve(null);
    }, timeout);
  });
}

/**
 * Enhanced function to expand sections with better error handling
 */
async function expandAllSections() {
  console.log("🔄 Expanding all sections...");
  
  try {
    // Wait for main content to load
    await waitForElement('.scaffold-layout__main', 5000);
    
    // Expand "Show all skills" with multiple selectors
    const skillSelectors = [
      'button[aria-label*="Show all skills"]',
      '.pv-skills-section__additional-skills button',
      '[data-field="skill_details"] button',
      '.pvs-list__footer-wrapper button'
    ];
    
    for (const selector of skillSelectors) {
      try {
        const showAllSkillsBtn = document.querySelector(selector);
        if (showAllSkillsBtn && showAllSkillsBtn.offsetParent !== null) {
          console.log(`🔄 Clicking skills button: ${selector}`);
          showAllSkillsBtn.click();
          await new Promise((resolve) => setTimeout(resolve, 2000));
          break;
        }
      } catch (err) {
        console.warn(`⚠️ Failed to click skills button ${selector}:`, err.message);
      }
    }

    // Expand "See more" buttons with enhanced selection
    const seeMoreSelectors = [
      'button[aria-expanded="false"][aria-label*="See more"]',
      'button[aria-expanded="false"][data-control-name*="see_more"]',
      '.inline-show-more-text__button',
      '.pv-shared-text-with-see-more__see-more-less-toggle'
    ];
    
    for (const selector of seeMoreSelectors) {
      try {
        const buttons = document.querySelectorAll(selector);
        console.log(`🔄 Found ${buttons.length} buttons for selector: ${selector}`);
        
        for (let btn of buttons) {
          try {
            if (btn.offsetParent !== null) { // Check if visible
              btn.click();
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          } catch (err) {
            console.warn(`⚠️ Failed to click see more button:`, err.message);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Error with selector ${selector}:`, err.message);
      }
    }
    
    console.log("✅ Section expansion completed");
  } catch (err) {
    console.warn("⚠️ Error expanding sections:", err.message);
  }
}

/**
 * Enhanced data extraction with multiple fallback selectors
 */
function extractStructuredData() {
  console.log("📊 Starting structured data extraction...");
  
  const data = {
    name: null,
    headline: null,
    location: null,
    aboutHtml: null,
    experienceHtml: null,
    educationHtml: null,
    skills: [],
    profileUrl: window.location.href,
    extractionTimestamp: new Date().toISOString()
  };

  try {
    // Enhanced name extraction with multiple selectors
    const nameSelectors = [
      'h1.text-heading-xlarge',
      '.pv-text-details__left-panel h1',
      '.ph5.pb5 h1',
      '.pv-top-card h1',
      'h1[data-field="name"]',
      '.pv-top-card__photo + div h1'
    ];
    
    for (const selector of nameSelectors) {
      const nameElement = document.querySelector(selector);
      if (nameElement && nameElement.textContent.trim()) {
        data.name = nameElement.textContent.trim();
        console.log(`✅ Name found with selector: ${selector} -> ${data.name}`);
        break;
      }
    }

    // Enhanced headline extraction
    const headlineSelectors = [
      '.text-body-medium.break-words',
      '.pv-text-details__left-panel .text-body-medium',
      '.ph5.pb5 .text-body-medium',
      '.pv-top-card .text-body-medium',
      '[data-field="headline"]'
    ];
    
    for (const selector of headlineSelectors) {
      const headlineElement = document.querySelector(selector);
      if (headlineElement && headlineElement.textContent.trim()) {
        data.headline = headlineElement.textContent.trim();
        console.log(`✅ Headline found with selector: ${selector}`);
        break;
      }
    }

    // Enhanced location extraction
    const locationSelectors = [
      '.text-body-small.inline.t-black--light.break-words',
      '.pv-text-details__left-panel .text-body-small',
      '.ph5.pb5 .text-body-small',
      '[data-field="location"]'
    ];
    
    for (const selector of locationSelectors) {
      const locationElement = document.querySelector(selector);
      if (locationElement && locationElement.textContent.trim()) {
        data.location = locationElement.textContent.trim();
        console.log(`✅ Location found with selector: ${selector}`);
        break;
      }
    }

  } catch (err) {
    console.warn("⚠️ Top card extraction failed:", err.message);
  }

  try {
    // Enhanced about section extraction
    const aboutSelectors = [
      '#about',
      '[data-field="summary"]',
      '.pv-about-section'
    ];
    
    for (const selector of aboutSelectors) {
      const aboutAnchor = document.querySelector(selector);
      if (aboutAnchor) {
        const aboutSection = aboutAnchor.closest('section.artdeco-card') || 
                           aboutAnchor.closest('section') ||
                           aboutAnchor.parentElement?.closest('section');
        
        if (aboutSection) {
          const aboutContent = aboutSection.querySelector('.display-flex.ph5.pv3') ||
                              aboutSection.querySelector('.pv-shared-text-with-see-more') ||
                              aboutSection.querySelector('.pv-about__summary-text');
          
          if (aboutContent) {
            data.aboutHtml = aboutContent.innerHTML;
            console.log("✅ About section extracted");
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ About extraction failed:", err.message);
  }

  try {
    // Enhanced experience extraction
    const experienceSelectors = [
      '#experience',
      '[data-field="experience"]',
      '.pv-profile-section.experience-section'
    ];
    
    for (const selector of experienceSelectors) {
      const experienceAnchor = document.querySelector(selector);
      if (experienceAnchor) {
        const experienceSection = experienceAnchor.closest('section.artdeco-card') ||
                                 experienceAnchor.closest('section') ||
                                 experienceAnchor.parentElement?.closest('section');
        
        if (experienceSection) {
          data.experienceHtml = experienceSection.innerHTML;
          console.log("✅ Experience section extracted");
          break;
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Experience extraction failed:", err.message);
  }

  try {
    // Enhanced education extraction
    const educationSelectors = [
      '#education',
      '[data-field="education"]',
      '.pv-profile-section.education-section'
    ];
    
    for (const selector of educationSelectors) {
      const educationAnchor = document.querySelector(selector);
      if (educationAnchor) {
        const educationSection = educationAnchor.closest('section.artdeco-card') ||
                               educationAnchor.closest('section') ||
                               educationAnchor.parentElement?.closest('section');
        
        if (educationSection) {
          data.educationHtml = educationSection.innerHTML;
          console.log("✅ Education section extracted");
          break;
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Education extraction failed:", err.message);
  }

  try {
    // Enhanced skills extraction with multiple strategies
    const skillsSelectors = [
      '#skills',
      '[data-field="skill_details"]',
      '.pv-profile-section.pv-skills-section'
    ];
    
    for (const selector of skillsSelectors) {
      const skillsAnchor = document.querySelector(selector);
      if (skillsAnchor) {
        const skillsSection = skillsAnchor.closest('section.artdeco-card') ||
                             skillsAnchor.closest('section') ||
                             skillsAnchor.parentElement?.closest('section');
        
        if (skillsSection) {
          // Try multiple skill element selectors
          const skillElementSelectors = [
            '.pvs-entity__skill-name',
            '.pv-skill-entity__skill-name',
            '.skill-category-entity__name',
            '[data-field="skill_name"]'
          ];
          
          for (const skillSelector of skillElementSelectors) {
            const skillElements = skillsSection.querySelectorAll(skillSelector);
            if (skillElements.length > 0) {
              data.skills = Array.from(skillElements)
                .map(el => el.textContent.trim())
                .filter(skill => skill.length > 0);
              console.log(`✅ Skills extracted with selector: ${skillSelector} (${data.skills.length} skills)`);
              break;
            }
          }
          
          if (data.skills.length > 0) break;
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Skills extraction failed:", err.message);
  }

  // Log extraction results
  console.log("📊 Extraction Results:", {
    name: data.name ? "✅" : "❌",
    headline: data.headline ? "✅" : "❌",
    location: data.location ? "✅" : "❌",
    aboutHtml: data.aboutHtml ? "✅" : "❌",
    experienceHtml: data.experienceHtml ? "✅" : "❌",
    educationHtml: data.educationHtml ? "✅" : "❌",
    skillsCount: data.skills.length
  });

  return data;
}

/**
 * Enhanced extraction with comprehensive error handling and recovery
 */
async function performExtraction() {
  if (extractionAttempted) {
    console.log("⚠️ Extraction already attempted, skipping");
    return;
  }
  
  extractionAttempted = true;
  console.log(`🚀 Starting extraction attempt ${retryCount + 1}/${MAX_RETRIES + 1} for: ${window.location.href}`);

  try {
    // Enhanced page validation
    if (!isLinkedInProfilePage()) {
      throw new Error(`Not on a LinkedIn profile page. Current URL: ${window.location.href}`);
    }

    // Wait for page to load completely
    console.log("⏳ Waiting for page to load...");
    await new Promise((resolve) => setTimeout(resolve, LINKEDIN_LOAD_WAIT));

    // Wait for critical elements
    console.log("⏳ Waiting for critical page elements...");
    const criticalElement = await waitForElement('h1, .pv-top-card, .scaffold-layout__main', 10000);
    
    if (!criticalElement) {
      throw new Error("Critical page elements not found - page may not have loaded properly");
    }

    // Expand sections for better data extraction
    await expandAllSections();

    // Extract data
    console.log("📊 Extracting profile data...");
    const profileData = extractStructuredData();

    // Enhanced validation
    if (!profileData.name || profileData.name.length < 2) {
      console.warn("⚠️ Profile name missing or invalid, attempting recovery...");
      
      // Try alternative name extraction methods
      const alternativeNameSelectors = [
        'title',
        'meta[property="og:title"]',
        '.top-card-layout__title',
        '.pv-top-card-profile-picture__image'
      ];
      
      for (const selector of alternativeNameSelectors) {
        try {
          let element = document.querySelector(selector);
          if (element) {
            let nameText = '';
            if (selector === 'title') {
              nameText = element.textContent.split('|')[0].trim();
            } else if (selector.includes('meta')) {
              nameText = element.getAttribute('content')?.split('|')[0].trim();
            } else if (selector.includes('image')) {
              nameText = element.getAttribute('alt')?.trim();
            } else {
              nameText = element.textContent.trim();
            }
            
            if (nameText && nameText.length > 2) {
              profileData.name = nameText;
              console.log(`✅ Recovered name using ${selector}: ${nameText}`);
              break;
            }
          }
        } catch (err) {
          console.warn(`⚠️ Failed to extract name from ${selector}:`, err.message);
        }
      }
    }

    // Final validation
    const hasMinimumData = profileData.name && profileData.name.length > 2;
    const hasAnyContent = profileData.aboutHtml || profileData.experienceHtml || 
                         profileData.educationHtml || profileData.skills.length > 0;

    if (!hasMinimumData) {
      throw new Error("Could not extract minimum required data (name) - page may not be fully loaded or accessible");
    }

    console.log(`✅ Extraction successful! Profile: ${profileData.name}, Skills: ${profileData.skills.length}, Has content: ${hasAnyContent}`);

    const message = {
      action: "extractionComplete",
      success: true,
      profileData: profileData,
      error: null,
      url: window.location.href,
      profileUrl: window.location.href,
      extractionMethod: searchContext.isBackgroundTab ? "background-tab-enhanced" : "visible-tab-enhanced",
      searchId: searchContext.searchId,
      backendUrl: searchContext.backendUrl,
      retryCount: retryCount,
      dataQuality: {
        hasName: !!profileData.name,
        hasHeadline: !!profileData.headline,
        hasLocation: !!profileData.location,
        hasAbout: !!profileData.aboutHtml,
        hasExperience: !!profileData.experienceHtml,
        hasEducation: !!profileData.educationHtml,
        skillsCount: profileData.skills.length
      }
    };

    // Send success message
    chrome.runtime.sendMessage(message);

  } catch (error) {
    console.error(`❌ Extraction attempt ${retryCount + 1} failed:`, error);
    retryCount++;

    if (retryCount <= MAX_RETRIES) {
      console.log(`🔄 Retrying in ${RETRY_DELAY}ms... (${retryCount}/${MAX_RETRIES})`);
      extractionAttempted = false;
      
      // Progressive delay increase
      const delay = RETRY_DELAY + (retryCount * 2000);
      setTimeout(performExtraction, delay);
      return;
    }

    console.error(`💀 Final failure after ${retryCount} attempts`);
    
    // Send failure message
    const message = {
      action: "extractionComplete",
      success: false,
      profileData: null,
      error: `Extraction failed after ${retryCount} attempts: ${error.message}`,
      url: window.location.href,
      profileUrl: window.location.href,
      extractionMethod: searchContext.isBackgroundTab ? "background-tab-enhanced" : "visible-tab-enhanced",
      retryCount: retryCount,
      searchId: searchContext.searchId,
      backendUrl: searchContext.backendUrl,
      finalError: true
    };

    chrome.runtime.sendMessage(message);
  }
}

/**
 * Enhanced initialization with better timing
 */
function initializeExtraction() {
  if (!isLinkedInProfilePage()) {
    console.log("❌ Not on a LinkedIn profile page:", window.location.href);
    
    // Send error for non-LinkedIn pages
    if (searchContext.searchId) {
      chrome.runtime.sendMessage({
        action: "extractionComplete",
        success: false,
        error: "Not a LinkedIn profile page",
        url: window.location.href,
        profileUrl: window.location.href,
        searchId: searchContext.searchId,
        backendUrl: searchContext.backendUrl
      });
    }
    return;
  }
  
  console.log("✅ On LinkedIn profile page, starting extraction...");
  
  // Different timing for background vs visible tabs
  const additionalWait = searchContext.isBackgroundTab ? 3000 : 1000;
  setTimeout(performExtraction, additionalWait);
}

// Enhanced page load detection
function handlePageLoad() {
  console.log("📄 Page load detected, document ready state:", document.readyState);
  
  if (searchContext.isBackgroundTab) {
    console.log("🔄 Background tab detected, waiting for context setup...");
    return; // Wait for setSearchContext message
  }
  
  // For visible tabs, start extraction after a delay
  setTimeout(initializeExtraction, 2000);
}

// Initialize for visible tabs
if (!searchContext.isBackgroundTab) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handlePageLoad);
  } else {
    handlePageLoad();
  }
}

// Enhanced error reporting
window.addEventListener('error', (event) => {
  console.error('❌ Page error detected:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled promise rejection:', event.reason);
});

console.log("🎯 Enhanced Bloomix content script initialized");

// ----- current working extension but stop in middle ------------
// // content.js - Improved version for targeted extraction

// let extractionAttempted = false;
// let retryCount = 0;
// const MAX_RETRIES = 2;
// const RETRY_DELAY = 5000;
// const LINKEDIN_LOAD_WAIT = 8000;

// const searchContext = {
//   searchId: null,
//   backendUrl: null,
//   isBackgroundTab: false,
// };

// console.log("Bloomix Extractor: Improved content script loaded on:", window.location.href);

// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request.action === "setSearchContext") {
//     searchContext.searchId = request.searchId;
//     searchContext.backendUrl = request.backendUrl;
//     searchContext.isBackgroundTab = true;
//     console.log("Bloomix Extractor: Search context set for background tab:", searchContext);
//     if (isLinkedInProfilePage()) {
//       console.log("Bloomix Extractor: Starting background tab extraction...");
//       setTimeout(initializeExtraction, LINKEDIN_LOAD_WAIT);
//     }
//     sendResponse({ success: true });
//     return true;
//   }

//   if (request.action === "extractData") {
//     searchContext.isBackgroundTab = false;
//     performExtraction()
//       .then(() => sendResponse({ success: true }))
//       .catch((error) => sendResponse({ success: false, error: error.message }));
//     return true;
//   }
// });

// function isLinkedInProfilePage() {
//   const url = window.location.href;
//   return url.includes("linkedin.com/in/");
// }

// /**
//  * Extracts structured data from the LinkedIn profile page by targeting specific sections.
//  * This is more robust than sending the entire DOM.
//  */
// function extractStructuredData() {
//     const data = {
//         name: null,
//         headline: null,
//         location: null,
//         aboutHtml: null,
//         experienceHtml: null,
//         educationHtml: null,
//         skills: [],
//         profileUrl: window.location.href
//     };

//     // --- Top Card ---
//     const topCardElement = document.querySelector('.pv-top-card, .ph5.pb5'); // Support for different top card selectors
//     if (topCardElement) {
//         const nameElement = topCardElement.querySelector('h1');
//         data.name = nameElement ? nameElement.textContent.trim() : null;

//         const headlineElement = topCardElement.querySelector('.text-body-medium.break-words');
//         data.headline = headlineElement ? headlineElement.textContent.trim() : null;

//         const locationElement = topCardElement.querySelector('.text-body-small.inline.t-black--light.break-words');
//         data.location = locationElement ? locationElement.textContent.trim() : null;
//     }

//     // --- About Section ---
//     const aboutAnchor = document.getElementById('about');
//     if (aboutAnchor) {
//         const aboutSection = aboutAnchor.closest('section.artdeco-card');
//         const aboutContent = aboutSection ? aboutSection.querySelector('.display-flex.ph5.pv3') : null;
//         data.aboutHtml = aboutContent ? aboutContent.innerHTML : null;
//     }

//     // --- Experience Section ---
//     const experienceAnchor = document.getElementById('experience');
//     if (experienceAnchor) {
//         const experienceSection = experienceAnchor.closest('section.artdeco-card');
//         data.experienceHtml = experienceSection ? experienceSection.innerHTML : null;
//     }

//     // --- Education Section ---
//     const educationAnchor = document.getElementById('education');
//     if (educationAnchor) {
//         const educationSection = educationAnchor.closest('section.artdeco-card');
//         data.educationHtml = educationSection ? educationSection.innerHTML : null;
//     }

//     // --- Skills Section ---
//     const skillsAnchor = document.getElementById('skills');
//     if (skillsAnchor) {
//         const skillsSection = skillsAnchor.closest('section.artdeco-card');
//         if (skillsSection) {
//             const skillElements = skillsSection.querySelectorAll('.pvs-entity__skill-name');
//             data.skills = Array.from(skillElements).map(el => el.textContent.trim());
//         }
//     }

//     return data;
// }


// async function performExtraction() {
//   if (extractionAttempted) {
//     console.log("Bloomix Extractor: Extraction already attempted, skipping");
//     return;
//   }
//   extractionAttempted = true;
//   console.log(`Bloomix Extractor: Starting extraction attempt ${retryCount + 1}/${MAX_RETRIES + 1}`);

//   try {
//     await new Promise((resolve) => setTimeout(resolve, LINKEDIN_LOAD_WAIT));

//     if (!isLinkedInProfilePage()) {
//       throw new Error(`Not on a LinkedIn profile page. Current URL: ${window.location.href}`);
//     }

//     const profileData = extractStructuredData();

//     if (!profileData.name) {
//         console.warn("Could not find profile name. Retrying...");
//         throw new Error("Profile name not found, page might not be fully loaded.");
//     }

//     console.log(`✅ Extraction successful! Profile: ${profileData.name}, Skills: ${profileData.skills.length}`);

//     const message = {
//       action: "extractionComplete",
//       success: true,
//       profileData: profileData, // Send structured data
//       error: null,
//       url: window.location.href,
//       profileUrl: window.location.href,
//       extractionMethod: searchContext.isBackgroundTab ? "background-tab-structured" : "visible-tab-structured",
//       searchId: searchContext.searchId,
//       backendUrl: searchContext.backendUrl,
//       retryCount: retryCount
//     };

//     chrome.runtime.sendMessage(message);

//   } catch (error) {
//     console.error(`❌ Extraction attempt ${retryCount + 1} failed:`, error);
//     retryCount++;

//     if (retryCount <= MAX_RETRIES) {
//       console.log(`🔄 Retrying in ${RETRY_DELAY}ms...`);
//       extractionAttempted = false;
//       setTimeout(performExtraction, RETRY_DELAY);
//       return;
//     }

//     console.error(`💀 Final failure after ${retryCount} attempts`);
//     const message = {
//       action: "extractionComplete",
//       success: false,
//       domContent: null, // Keep this null on failure
//       profileData: null,
//       error: `Extraction failed after ${retryCount} attempts: ${error.message}`,
//       url: window.location.href,
//       profileUrl: window.location.href,
//       extractionMethod: searchContext.isBackgroundTab ? "background-tab-structured" : "visible-tab-structured",
//       retryCount: retryCount,
//       searchId: searchContext.searchId,
//       backendUrl: searchContext.backendUrl
//     };

//     chrome.runtime.sendMessage(message);
//   }
// }

// function initializeExtraction() {
//   if (!isLinkedInProfilePage()) {
//     console.log("Bloomix Extractor: Not on a LinkedIn profile page");
//     return;
//   }
//   console.log("Bloomix Extractor: On LinkedIn profile page, starting extraction...");
//   const additionalWait = searchContext.isBackgroundTab ? 2000 : 1000;
//   setTimeout(performExtraction, additionalWait);
// }

// // Initial load for visible tabs
// if (!searchContext.isBackgroundTab) {
//     if (document.readyState === "loading") {
//         document.addEventListener("DOMContentLoaded", () => setTimeout(initializeExtraction, 2000));
//     } else {
//         setTimeout(initializeExtraction, 2000);
//     }
// }

// ----chat gpt for linkedin extractionon ------------
// // content.js - Full improved version with safe extraction

// let extractionAttempted = false;
// let retryCount = 0;
// const MAX_RETRIES = 2;
// const RETRY_DELAY = 5000;
// const LINKEDIN_LOAD_WAIT = 8000;

// const searchContext = {
//   searchId: null,
//   backendUrl: null,
//   isBackgroundTab: false,
// };

// console.log("Bloomix Extractor: Full content script loaded on:", window.location.href);

// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request.action === "setSearchContext") {
//     searchContext.searchId = request.searchId;
//     searchContext.backendUrl = request.backendUrl;
//     searchContext.isBackgroundTab = true;
//     console.log("Bloomix Extractor: Search context set:", searchContext);
//     if (isLinkedInProfilePage()) {
//       setTimeout(initializeExtraction, LINKEDIN_LOAD_WAIT);
//     }
//     sendResponse({ success: true });
//     return true;
//   }

//   if (request.action === "extractData") {
//     searchContext.isBackgroundTab = false;
//     performExtraction()
//       .then(() => sendResponse({ success: true }))
//       .catch((error) => sendResponse({ success: false, error: error.message }));
//     return true;
//   }
// });

// function isLinkedInProfilePage() {
//   return window.location.href.includes("linkedin.com/in/");
// }

// /**
//  * Expand hidden sections before scraping
//  */
// async function expandAllSections() {
//   try {
//     // Expand "Show all skills"
//     const showAllSkillsBtn = document.querySelector('button[aria-label*="Show all skills"], .pv-skills-section__additional-skills');
//     if (showAllSkillsBtn) {
//       console.log("Bloomix Extractor: Clicking 'Show all skills'...");
//       showAllSkillsBtn.click();
//       await new Promise((resolve) => setTimeout(resolve, 2000));
//     }

//     // Expand "See more" in experience/projects
//     const seeMoreButtons = document.querySelectorAll('button[aria-expanded="false"][aria-label*="See more"]');
//     for (let btn of seeMoreButtons) {
//       try {
//         btn.click();
//         await new Promise((resolve) => setTimeout(resolve, 1000));
//       } catch (err) {
//         console.warn("Failed to expand a section:", err.message);
//       }
//     }
//   } catch (err) {
//     console.warn("Error expanding sections:", err.message);
//   }
// }

// /**
//  * Extract structured profile data
//  */
// function extractStructuredData() {
//   const data = {
//     name: null,
//     headline: null,
//     location: null,
//     aboutHtml: null,
//     experienceHtml: null,
//     educationHtml: null,
//     projectsHtml: null,
//     skills: [],
//     profileUrl: window.location.href
//   };

//   try {
//     // --- Top Card ---
//     const topCardElement = document.querySelector('.pv-top-card, .ph5.pb5');
//     if (topCardElement) {
//       data.name = topCardElement.querySelector('h1')?.textContent.trim() || null;
//       data.headline = topCardElement.querySelector('.text-body-medium.break-words')?.textContent.trim() || null;
//       data.location = topCardElement.querySelector('.text-body-small.inline.t-black--light.break-words')?.textContent.trim() || null;
//     }
//   } catch (err) {
//     console.warn("Top card extraction failed:", err.message);
//   }

//   try {
//     // --- About ---
//     const aboutAnchor = document.getElementById('about');
//     if (aboutAnchor) {
//       const aboutSection = aboutAnchor.closest('section.artdeco-card');
//       const aboutContent = aboutSection?.querySelector('.display-flex.ph5.pv3');
//       data.aboutHtml = aboutContent ? aboutContent.innerHTML : null;
//     }
//   } catch (err) {
//     console.warn("About extraction failed:", err.message);
//   }

//   try {
//     // --- Experience (work + company) ---
//     const experienceAnchor = document.getElementById('experience');
//     if (experienceAnchor) {
//       const experienceSection = experienceAnchor.closest('section.artdeco-card');
//       data.experienceHtml = experienceSection ? experienceSection.innerHTML : null;
//     }
//   } catch (err) {
//     console.warn("Experience extraction failed:", err.message);
//   }

//   try {
//     // --- Education ---
//     const educationAnchor = document.getElementById('education');
//     if (educationAnchor) {
//       const educationSection = educationAnchor.closest('section.artdeco-card');
//       data.educationHtml = educationSection ? educationSection.innerHTML : null;
//     }
//   } catch (err) {
//     console.warn("Education extraction failed:", err.message);
//   }

//   try {
//     // --- Projects ---
//     const projectsAnchor = document.getElementById('projects');
//     if (projectsAnchor) {
//       const projectsSection = projectsAnchor.closest('section.artdeco-card');
//       data.projectsHtml = projectsSection ? projectsSection.innerHTML : null;
//     }
//   } catch (err) {
//     console.warn("Projects extraction failed:", err.message);
//   }

//   try {
//     // --- Skills ---
//     const skillsAnchor = document.getElementById('skills');
//     if (skillsAnchor) {
//       const skillsSection = skillsAnchor.closest('section.artdeco-card');
//       if (skillsSection) {
//         const skillElements = skillsSection.querySelectorAll('.pvs-entity__skill-name');
//         data.skills = Array.from(skillElements).map(el => el.textContent.trim());
//       }
//     }
//   } catch (err) {
//     console.warn("Skills extraction failed:", err.message);
//   }

//   return data;
// }

// /**
//  * Perform full extraction
//  */
// async function performExtraction() {
//   if (extractionAttempted) {
//     console.log("Bloomix Extractor: Extraction already attempted, skipping");
//     return;
//   }
//   extractionAttempted = true;

//   try {
//     await new Promise((resolve) => setTimeout(resolve, LINKEDIN_LOAD_WAIT));
//     if (!isLinkedInProfilePage()) throw new Error("Not on a LinkedIn profile page");

//     await expandAllSections();
//     const profileData = extractStructuredData();

//     if (!profileData.name) {
//       console.warn("⚠️ Profile name missing, sending partial data instead of failing.");
//       chrome.runtime.sendMessage({
//         action: "extractionComplete",
//         success: false, // mark failed, but continue
//         profileData,
//         error: "Profile name not found (page may not be fully loaded)",
//         url: window.location.href,
//         profileUrl: window.location.href,
//         extractionMethod: searchContext.isBackgroundTab ? "background-tab-structured" : "visible-tab-structured",
//         searchId: searchContext.searchId,
//         backendUrl: searchContext.backendUrl,
//         retryCount
//       });
//       return;
//     }

//     console.log(`✅ Extraction successful: ${profileData.name}, Skills: ${profileData.skills.length}`);

//     chrome.runtime.sendMessage({
//       action: "extractionComplete",
//       success: true,
//       profileData,
//       error: null,
//       url: window.location.href,
//       profileUrl: window.location.href,
//       extractionMethod: searchContext.isBackgroundTab ? "background-tab-structured" : "visible-tab-structured",
//       searchId: searchContext.searchId,
//       backendUrl: searchContext.backendUrl,
//       retryCount
//     });

//   } catch (error) {
//     console.error(`❌ Extraction attempt ${retryCount + 1} failed:`, error.message);
//     retryCount++;
//     if (retryCount <= MAX_RETRIES) {
//       console.log(`🔄 Retrying in ${RETRY_DELAY}ms...`);
//       extractionAttempted = false;
//       setTimeout(performExtraction, RETRY_DELAY);
//       return;
//     }
//     // final failure but still notify
//     chrome.runtime.sendMessage({
//       action: "extractionComplete",
//       success: false,
//       profileData: null,
//       error: `Extraction failed: ${error.message}`,
//       url: window.location.href,
//       profileUrl: window.location.href,
//       extractionMethod: searchContext.isBackgroundTab ? "background-tab-structured" : "visible-tab-structured",
//       searchId: searchContext.searchId,
//       backendUrl: searchContext.backendUrl,
//       retryCount
//     });
//   }
// }

// /**
//  * Initialize extraction
//  */
// function initializeExtraction() {
//   if (!isLinkedInProfilePage()) {
//     console.log("Bloomix Extractor: Not a LinkedIn profile page");
//     return;
//   }
//   console.log("Bloomix Extractor: Starting extraction...");
//   const delay = searchContext.isBackgroundTab ? 2000 : 1000;
//   setTimeout(performExtraction, delay);
// }

// // Auto-run on visible tabs
// if (!searchContext.isBackgroundTab) {
//   if (document.readyState === "loading") {
//     document.addEventListener("DOMContentLoaded", () => setTimeout(initializeExtraction, 2000));
//   } else {
//     setTimeout(initializeExtraction, 2000);
//   }
// }


