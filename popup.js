document.addEventListener("DOMContentLoaded", async () => {
  const extractButton = document.getElementById("extractButton");
  const testConnectionButton = document.getElementById("testConnection");
  const statusDiv = document.getElementById("status");
  const searchListDiv = document.getElementById("searchList");

  // Configuration for different environments
  const CONFIG = {
    development: "http://localhost:5000/v1",
    production: "https://bloomix-frontend-test.onrender.com/v1", // Update this
  };

  // Detect environment
  const ENVIRONMENT = window.location.hostname === "localhost" ? "development" : "production";
  const BACKEND_URL = "http://localhost:5000/v1"; // Force localhost for now
  
  console.log("Popup Environment:", ENVIRONMENT);
  console.log("Popup Backend URL:", BACKEND_URL);

  // Update status and active searches
  updateStatus();
  updateActiveSearches();

  // Extract current page with enhanced error handling
  extractButton.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url.includes("linkedin.com/in/")) {
        statusDiv.textContent = "Please navigate to a LinkedIn profile page";
        statusDiv.className = "status inactive";
        return;
      }

      statusDiv.textContent = "Extracting data...";
      statusDiv.className = "status active";
      
      // Increase timeout for extraction
      const extractionTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Extraction timeout after 60 seconds")), 60000);
      });
      
      const extractionPromise = chrome.tabs.sendMessage(tab.id, { action: "extractData" });
      
      const response = await Promise.race([extractionPromise, extractionTimeout]);
      
      if (response && response.success) {
        statusDiv.textContent = `Extracted: ${response.profileData?.name || "Profile data"}`;
        statusDiv.className = "status active";
      } else {
        statusDiv.textContent = `Extraction failed: ${response?.error || "Unknown error"}`;
        statusDiv.className = "status inactive";
      }
    } catch (error) {
      console.error("Extraction error:", error);
      if (error.message.includes("Could not establish connection")) {
        statusDiv.textContent = "Error: Content script not loaded. Try refreshing the page.";
      } else if (error.message.includes("timeout")) {
        statusDiv.textContent = "Error: Extraction took too long. LinkedIn may be blocking.";
      } else {
        statusDiv.textContent = `Error: ${error.message}`;
      }
      statusDiv.className = "status inactive";
    }
  });

  // Test backend connection with enhanced error reporting
  testConnectionButton.addEventListener("click", async () => {
    statusDiv.textContent = "Testing connection...";
    statusDiv.className = "status active";
    
    try {
      console.log(`Testing connection to: ${BACKEND_URL}/api/headhunter/test`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(`${BACKEND_URL}/api/headhunter/test`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        statusDiv.textContent = `Backend connected (${ENVIRONMENT})`;
        statusDiv.className = "status active";
        console.log("Backend response:", data);
      } else {
        statusDiv.textContent = `Backend connection failed (${response.status})`;
        statusDiv.className = "status inactive";
        console.error("Backend error response:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("Connection error:", error);
      if (error.name === 'AbortError') {
        statusDiv.textContent = `Backend connection timeout (${ENVIRONMENT})`;
      } else if (error.message.includes("fetch")) {
        statusDiv.textContent = `Backend not reachable (${ENVIRONMENT})`;
      } else {
        statusDiv.textContent = `Connection error: ${error.message}`;
      }
      statusDiv.className = "status inactive";
    }
  });

  // Enhanced status update with better error handling
  async function updateStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getActiveSearches" });
      
      if (response && response.searches) {
        const searchCount = response.searches.length;
        if (searchCount > 0) {
          statusDiv.textContent = `${searchCount} active search(es) (${ENVIRONMENT})`;
          statusDiv.className = "status active";
        } else {
          statusDiv.textContent = `Extension Ready (${ENVIRONMENT})`;
          statusDiv.className = "status inactive";
        }
      } else {
        statusDiv.textContent = "Extension Status Unknown";
        statusDiv.className = "status inactive";
      }
    } catch (error) {
      console.error("Error updating status:", error);
      statusDiv.textContent = "Extension Error";
      statusDiv.className = "status inactive";
    }
  }

  // Enhanced active searches update
  async function updateActiveSearches() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getActiveSearches" });
      
      if (response && response.searches) {
        const searches = response.searches;
        if (searches.length === 0) {
          searchListDiv.innerHTML = `
            <div>No active searches</div>
            <div style="font-size: 10px; color: #666;">Environment: ${ENVIRONMENT}</div>
            <div style="font-size: 10px; color: #666;">Backend: ${BACKEND_URL}</div>
          `;
        } else {
          const searchItems = searches.map((searchId) => 
            `<div class="search-item">Search: ${searchId}</div>`
          ).join("");
          
          searchListDiv.innerHTML = `
            ${searchItems}
            <div style="font-size: 10px; color: #666; margin-top: 5px;">Environment: ${ENVIRONMENT}</div>
            <div style="font-size: 10px; color: #666;">Backend: ${BACKEND_URL}</div>
          `;
        }
      } else {
        searchListDiv.innerHTML = `
          <div style="color: #dc3545;">Error loading searches</div>
          <div style="font-size: 10px; color: #666;">Environment: ${ENVIRONMENT}</div>
        `;
      }
    } catch (error) {
      console.error("Error updating active searches:", error);
      searchListDiv.innerHTML = `
        <div style="color: #dc3545;">Error: ${error.message}</div>
        <div style="font-size: 10px; color: #666;">Environment: ${ENVIRONMENT}</div>
      `;
    }
  }

  // Enhanced periodic updates with error handling
  const updateInterval = setInterval(async () => {
    try {
      await updateStatus();
      await updateActiveSearches();
    } catch (error) {
      console.error("Error in periodic update:", error);
      // Don't clear the interval, just log the error
    }
  }, 5000);

  // Clean up interval when popup closes
  window.addEventListener('beforeunload', () => {
    clearInterval(updateInterval);
  });

  // Add manual refresh button functionality
  const refreshButton = document.createElement('button');
  refreshButton.textContent = 'Refresh Status';
  refreshButton.className = 'secondary';
  refreshButton.style.fontSize = '12px';
  refreshButton.style.padding = '5px';
  refreshButton.style.marginTop = '10px';
  
  refreshButton.addEventListener('click', async () => {
    await updateStatus();
    await updateActiveSearches();
  });
  
  document.body.appendChild(refreshButton);
});
