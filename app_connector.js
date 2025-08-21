// app_connector.js - Fixed connector without chrome redeclaration
console.log("Bloomix Connector Script: Initializing...")

// Enhanced environment detection
const isLocalhost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname.includes("localhost")
const isDevelopment = isLocalhost || window.location.hostname.includes("dev")
console.log(`Bloomix Connector: Running in ${isDevelopment ? "development" : "production"} mode`)

// Announce extension availability
window.postMessage({ type: "BLOOMIX_EXTENSION_INSTALLED" }, "*")
console.log("Bloomix Connector: Extension ready and announced to page")

// Enhanced message handling
window.addEventListener("message", (event) => {
  // Security check - only accept messages from same window
  if (event.source !== window) {
    return
  }
  const { type, payload } = event.data
  switch (type) {
    case "START_LINKEDIN_EXTRACTION":
      console.log("Connector: Received extraction start request:", payload)
      handleExtractionStart(payload)
      break
    case "BLOOMIX_PING":
      console.log("Connector: Received ping, sending pong")
      window.postMessage({ type: "BLOOMIX_PONG" }, "*")
      break
    default:
      // Ignore other message types
      break
  }
})

/**
 * Sends a message to the Chrome Extension background script with retry logic and a readiness check.
 * It first pings the background script to ensure it's awake and ready, then sends the actual message.
 * @param {object} message The message payload to send.
 * @param {number} maxRetries Maximum number of retries for both ping and the main message.
 * @param {number} initialDelay Initial delay in ms before retrying.
 * @returns {Promise<any>} The response from the background script.
 * @throws {Error} If the message fails after all retries or for other unhandled errors.
 */
async function sendMessageToBackground(message, maxRetries = 5, initialDelay = 200) {
  // First, ensure the service worker is awake and responsive by pinging it
  let pingSuccess = false;
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Connector: Pinging background script to ensure readiness (${i + 1}/${maxRetries})...`);
      const pingResponse = await window.chrome.runtime.sendMessage({ action: "ping" });
      if (pingResponse && pingResponse.success) {
        pingSuccess = true;
        console.log("Connector: Background script is ready.");
        break;
      }
    } catch (error) {
      console.warn(`Connector: Ping failed (${i + 1}/${maxRetries}): ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1))); // Exponential backoff for ping
  }

  if (!pingSuccess) {
    throw new Error("Background script did not respond to pings after multiple retries. Context might be permanently invalidated.");
  }

  // Now that the background script is confirmed ready, send the actual message with retries
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await window.chrome.runtime.sendMessage(message);
    } catch (error) {
      if (error.message.includes("Extension context invalidated")) {
        console.warn(`Connector: Extension context invalidated during message send. Retrying (${i + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1))); // Exponential backoff for message
      } else {
        throw error; // Re-throw other errors immediately
      }
    }
  }
  throw new Error("Failed to send message to background after multiple retries due to context invalidation.");
}


async function handleExtractionStart(payload) {
  try {
    if (!payload || !payload.searchId || !payload.urls) {
      console.error("Connector: Invalid extraction payload:", payload)
      return
    }
    console.log(`Connector: Starting extraction for search ${payload.searchId} with ${payload.urls.length} URLs`)
    
    const response = await sendMessageToBackground({
      action: "startSearch",
      searchId: payload.searchId,
      urls: payload.urls,
      backendUrl: payload.backendUrl,
    });

    if (response && response.success) {
      console.log("Connector: Successfully started extraction in background")
    } else {
      console.error("Connector: Failed to start extraction:", response?.error)
      // Inform the frontend about the failure
      window.postMessage({
        type: "LINKEDIN_EXTRACTION_ERROR",
        payload: { message: `Failed to start extraction: ${response?.error || "Unknown error"}` }
      }, "*");
    }
  } catch (error) {
    console.error("Connector: Error handling extraction start:", error)
    // Inform the frontend about the failure
    window.postMessage({
      type: "LINKEDIN_EXTRACTION_ERROR",
      payload: { message: `Failed to start extraction: ${error.message}` }
    }, "*");
  }
}

// Test connection on load - this initial ping is still useful for immediate feedback
setTimeout(() => {
  window.chrome.runtime
    .sendMessage({ action: "ping" })
    .then((response) => {
      if (response && response.success) {
        console.log("Connector: Initial ping successful.")
      }
    })
    .catch((error) => {
      console.error("Connector: Initial ping failed:", error)
    })
}, 1000)