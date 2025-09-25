import { createClient } from 'https://esm.sh/@anam-ai/js-sdk@latest';
import { AnamEvent } from 'https://esm.sh/@anam-ai/js-sdk@latest/dist/module/types';

let anamClient = null;

// Get DOM elements
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const videoElement = document.getElementById('persona-video');
const chatHistory = document.getElementById('chat-history');

// Button state management
function setButtonLoading(button, isLoading, originalText) {
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = originalText || button.textContent;
    button.innerHTML = `
      <span class="loading-spinner" aria-hidden="true">⏳</span>
      Loading...
    `;
    button.style.opacity = '0.8';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || originalText;
    button.style.opacity = '1';
  }
}

// Legacy status functions (no longer needed with toast system)
// These are kept for compatibility but can be removed

// Chat history management
function updateChatHistory(messages) {
  if (!chatHistory) return;

  chatHistory.innerHTML = '';

  if (messages.length === 0) {
    chatHistory.innerHTML = `
      <div class="chat-empty-state">
        <span aria-hidden="true">👋</span>
        <span>Start a conversation to see your chat history...</span>
      </div>
    `;
    return;
  }

  messages.forEach((message, index) => {
    const messageContainer = document.createElement('div');
    messageContainer.className = 'chat-message';

    const messageBubble = document.createElement('div');
    const isUser = message.role === 'user';
    messageBubble.className = `message-bubble ${isUser ? 'user' : 'assistant'}`;

    const senderElement = document.createElement('div');
    senderElement.className = 'message-sender';
    senderElement.textContent = isUser ? 'You' : 'Cara';

    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    contentElement.textContent = message.content;

    messageBubble.appendChild(senderElement);
    messageBubble.appendChild(contentElement);
    messageContainer.appendChild(messageBubble);

    chatHistory.appendChild(messageContainer);
  });

  // Smooth scroll to bottom
  requestAnimationFrame(() => {
    chatHistory.scrollTo({
      top: chatHistory.scrollHeight,
      behavior: 'smooth'
    });
  });
}

// Custom LLM response handler
async function handleUserMessage(messageHistory) {
  // Only respond to user messages
  if (messageHistory.length === 0 || messageHistory[messageHistory.length - 1].role !== 'user') {
    return;
  }

  if (!anamClient) return;

  const maxRetries = 3;
  let retryCount = 0;

  try {
    console.log('🧠 Getting custom LLM response for:', messageHistory);

    // Convert Anam message format to OpenAI format
    const openAIMessages = messageHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));

    // Create a streaming talk session
    const talkStream = anamClient.createTalkMessageStream();

    // Call our custom LLM streaming endpoint
    const response = await fetch('/api/chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: openAIMessages }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response stream reader');
    }

    const textDecoder = new TextDecoder();
    console.log('🎤 Streaming LLM response to persona...');

    // Stream the response chunks to the persona
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log('✅ LLM streaming complete');
        if (talkStream.isActive()) {
          talkStream.endMessage();
        }
        break;
      }

      if (value) {
        const text = textDecoder.decode(value);
        const lines = text.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.content && talkStream.isActive()) {
              talkStream.streamMessageChunk(data.content, false);
            }
          } catch (parseError) {
            // Ignore parse errors in streaming
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Custom LLM error:', error);
    if (anamClient) {
      anamClient.talk(
        "I'm sorry, I encountered an error while processing your request. Please try again."
      );
    }
  }
}

// Track loading toast ID for proper management
let loadingToastId = null;
let isDisconnecting = false; // Flag to prevent multiple disconnect toasts

// Audio permission handling
async function requestAudioPermissions() {
  try {
    // Request microphone permission to ensure audio works
    await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('🎤 Audio permissions granted');
    return true;
  } catch (error) {
    console.warn('🔇 Audio permission denied or unavailable:', error);
    toastManager.warning('Audio permission required for voice', {
      title: 'Audio Permission',
      description: 'Please allow microphone access for voice conversations'
    });
    return false;
  }
}

// Enable audio playback on video element
function enableVideoAudio() {
  const videoElement = document.getElementById('persona-video');
  if (videoElement) {
    videoElement.muted = false;
    videoElement.volume = 1.0;
    console.log('🔊 Video audio enabled');
  }
}

async function startConversation() {
  let connectionTimeout;

  try {
    setButtonLoading(startButton, true, '▶️ Start Conversation');

    // Request audio permissions first (user interaction required)
    const audioPermissionGranted = await requestAudioPermissions();
    if (!audioPermissionGranted) {
      setButtonLoading(startButton, false);
      return;
    }

    // Enable video audio playback
    enableVideoAudio();

    // Show loading toast
    loadingToastId = toastManager.loading('Connecting to AI persona...', {
      title: 'Connecting',
      description: 'Please wait while we establish the connection'
    });

    // Set up connection timeout (10 seconds)
    connectionTimeout = setTimeout(() => {
      console.error('🕐 Connection timeout after 10 seconds');
      if (loadingToastId) {
        toastManager.hide(loadingToastId);
        loadingToastId = null;
      }
      toastManager.error('Connection timed out', {
        title: 'Connection Timeout',
        description: 'Unable to connect to AI service. Please try again.'
      });
      setButtonLoading(startButton, false);
      startButton.disabled = false;
    }, 10000);

    console.log('🚀 Starting conversation...');
    console.log('📞 Fetching session token...');

    // Get session token from server
    const response = await fetch('/api/session-token', {
      method: 'POST',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Session token failed: ${response.status} - ${errorData.details || response.statusText}`);
    }

    const { sessionToken } = await response.json();
    console.log('✅ Session token received:', sessionToken?.substring(0, 20) + '...');

    // Create Anam client
    console.log('🔧 Creating Anam client...');
    anamClient = createClient(sessionToken);

    // Set up event listeners
    anamClient.addListener(AnamEvent.SESSION_READY, () => {
      console.log('🎯 Session ready!');
      console.log('🎬 Video element audio status:', {
        muted: videoElement.muted,
        volume: videoElement.volume,
        hasAudio: !!videoElement.srcObject
      });

      // Clear timeout since connection succeeded
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }

      // Hide loading toast and show success
      if (loadingToastId) {
        toastManager.hide(loadingToastId);
        loadingToastId = null;
      }
      toastManager.success('Connected successfully!', {
        title: 'Connected',
        description: 'Your AI assistant is ready to chat'
      });

      setButtonLoading(startButton, false);
      startButton.disabled = true;
      stopButton.disabled = false;

      // Focus management - move focus to stop button
      stopButton.focus();

      // Send initial greeting
      anamClient.talk("Hello! I'm Cara, powered by a custom AI brain. How can I help you today?");
    });

    anamClient.addListener(AnamEvent.CONNECTION_CLOSED, () => {
      console.log('🔌 Connection closed');

      // Clear timeout if connection closed
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }

      // Don't show toast for automatic disconnections
      stopConversation(false);
    });

    // This is the key event for custom LLM integration
    anamClient.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, handleUserMessage);

    // Update chat history in real-time
    anamClient.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
      updateChatHistory(messages);
    });

    // Handle stream interruptions
    anamClient.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, () => {
      console.log('🛑 Talk stream interrupted by user');
    });

    // Start streaming to video element
    console.log('🎬 Starting video stream...');
    await anamClient.streamToVideoElement('persona-video');

    // Additional audio debugging after streaming starts
    setTimeout(() => {
      console.log('🔍 Post-stream audio check:', {
        videoMuted: videoElement.muted,
        videoVolume: videoElement.volume,
        streamActive: !!videoElement.srcObject,
        audioTracks: videoElement.srcObject?.getAudioTracks?.()?.length || 0
      });
    }, 2000);

    console.log('🚀 Custom LLM persona started successfully!');
  } catch (error) {
    console.error('❌ Failed to start conversation:', error);

    // Clear timeout on error
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }

    // Hide loading toast and show error
    if (loadingToastId) {
      toastManager.hide(loadingToastId);
      loadingToastId = null;
    }
    toastManager.error('Connection failed', {
      title: 'Connection Error',
      description: error.message || 'Unable to connect to the AI service. Please try again.'
    });

    setButtonLoading(startButton, false);
    startButton.disabled = false;

    // Focus management - return focus to start button
    startButton.focus();
  }
}

function stopConversation(showToast = true) {
  // Prevent multiple simultaneous disconnections
  if (isDisconnecting) {
    console.log('🛑 Already disconnecting, skipping...');
    return;
  }
  isDisconnecting = true;

  if (anamClient) {
    anamClient.stopStreaming();
    anamClient = null;
  }

  // Hide any loading toasts
  if (loadingToastId) {
    toastManager.hide(loadingToastId);
    loadingToastId = null;
  }

  // Show disconnection toast only if requested and not already shown
  if (showToast && !toastManager.hasActiveToast('info', 'Session Ended')) {
    toastManager.info('Disconnected', {
      title: 'Session Ended',
      description: 'Your conversation has been ended'
    });
  }

  // Reset UI
  videoElement.srcObject = null;
  updateChatHistory([]);
  setButtonLoading(startButton, false);
  startButton.disabled = false;
  stopButton.disabled = true;

  console.log('🛑 Conversation stopped');

  // Reset disconnection flag after a brief delay
  setTimeout(() => {
    isDisconnecting = false;
  }, 500);
}

// Keyboard Navigation and Accessibility
function handleKeyboardNavigation(event) {
  // Handle Enter and Space keys for buttons
  if (event.target.classList.contains('btn') && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    event.target.click();
  }

  // Handle Escape key to stop conversation (with toast for user action)
  if (event.key === 'Escape' && !stopButton.disabled) {
    stopConversation(true);
    stopButton.focus();
  }

  // Handle Tab navigation within chat history
  if (event.target === chatHistory && event.key === 'Tab') {
    const lastMessage = chatHistory.querySelector('.chat-message:last-child .message-content');
    if (lastMessage) {
      lastMessage.setAttribute('tabindex', '0');
      lastMessage.focus();
    }
  }
}

// Announce important status changes to screen readers
function announceToScreenReader(message, priority = 'polite') {
  const announcement = document.createElement('div');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove announcement after screen reader has had time to read it
  setTimeout(() => {
    if (announcement.parentNode) {
      announcement.parentNode.removeChild(announcement);
    }
  }, 1000);
}

// Legacy announcement function (replaced by toast system)
// Kept for compatibility but functionality moved to toastManager

// Toast Notification System
class ToastManager {
  constructor() {
    this.container = null;
    this.toasts = new Map();
    this.toastCounter = 0;
    this.activeToastTypes = new Set(); // Track active toast types to prevent duplicates
    this.init();
  }

  init() {
    // Create toast container
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(this.container);
  }

  show(message, type = 'info', options = {}) {
    const {
      title = this.getDefaultTitle(type),
      duration = this.getDefaultDuration(type),
      persistent = false,
      description = null,
      allowDuplicates = false
    } = options;

    // Check for duplicate toast types (unless explicitly allowed)
    const toastKey = `${type}-${title}`;
    if (!allowDuplicates && this.activeToastTypes.has(toastKey)) {
      console.log(`Preventing duplicate toast: ${toastKey}`);
      return null; // Don't show duplicate
    }

    const toastId = `toast-${++this.toastCounter}`;
    const toast = this.createToast(toastId, title, message, description, type, persistent, duration);

    // Track this toast type as active
    this.activeToastTypes.add(toastKey);
    toast.dataset.toastKey = toastKey; // Store for cleanup

    this.container.appendChild(toast);
    this.toasts.set(toastId, toast);

    // Trigger show animation
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Auto-dismiss if not persistent
    if (!persistent && duration > 0) {
      setTimeout(() => {
        this.hide(toastId);
      }, duration);
    }

    // Announce to screen readers
    this.announceToScreenReader(title + (description ? ': ' + description : ''), type === 'error' ? 'assertive' : 'polite');

    return toastId;
  }

  hide(toastId) {
    const toast = this.toasts.get(toastId);
    if (!toast) return;

    // Remove from active toast types tracking
    const toastKey = toast.dataset.toastKey;
    if (toastKey) {
      this.activeToastTypes.delete(toastKey);
    }

    toast.classList.remove('show');
    toast.classList.add('hide');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      this.toasts.delete(toastId);
    }, 300);
  }

  hideAll() {
    this.toasts.forEach((toast, toastId) => {
      this.hide(toastId);
    });
    // Clear all active toast types
    this.activeToastTypes.clear();
  }

  // Check if a specific toast type is currently active
  hasActiveToast(type, title = null) {
    const toastKey = title ? `${type}-${title}` : type;
    return Array.from(this.activeToastTypes).some(key => key.startsWith(toastKey));
  }

  // Hide toasts of a specific type
  hideToastsByType(type, title = null) {
    this.toasts.forEach((toast, toastId) => {
      const toastKey = toast.dataset.toastKey;
      if (toastKey && (title ? toastKey === `${type}-${title}` : toastKey.startsWith(`${type}-`))) {
        this.hide(toastId);
      }
    });
  }

  createToast(id, title, message, description, type, persistent, duration) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-labelledby', `${id}-title`);
    if (description) {
      toast.setAttribute('aria-describedby', `${id}-desc`);
    }

    const icon = this.getIcon(type);

    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon" aria-hidden="true">${icon}</div>
        <div class="toast-message">
          <div id="${id}-title" class="toast-title">${title}</div>
          ${description ? `<div id="${id}-desc" class="toast-description">${description}</div>` : ''}
        </div>
        ${!persistent ? `<button class="toast-close" aria-label="Close notification" type="button">×</button>` : ''}
      </div>
      ${!persistent && duration > 0 ? '<div class="toast-progress"></div>' : ''}
    `;

    // Add close button event listener
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hide(id);
      });
    }

    return toast;
  }

  getIcon(type) {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
      loading: '⏳'
    };
    return icons[type] || icons.info;
  }

  getDefaultTitle(type) {
    const titles = {
      success: 'Success',
      error: 'Error',
      warning: 'Warning',
      info: 'Info',
      loading: 'Loading'
    };
    return titles[type] || titles.info;
  }

  getDefaultDuration(type) {
    const durations = {
      success: 4000,
      error: 6000,
      warning: 5000,
      info: 4000,
      loading: 0 // persistent by default
    };
    return durations[type] || durations.info;
  }

  announceToScreenReader(message, priority = 'polite') {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;

    document.body.appendChild(announcement);

    setTimeout(() => {
      if (announcement.parentNode) {
        announcement.parentNode.removeChild(announcement);
      }
    }, 1000);
  }

  // Convenience methods
  success(message, options = {}) {
    return this.show(message, 'success', options);
  }

  error(message, options = {}) {
    return this.show(message, 'error', options);
  }

  warning(message, options = {}) {
    return this.show(message, 'warning', options);
  }

  info(message, options = {}) {
    return this.show(message, 'info', options);
  }

  loading(message, options = {}) {
    return this.show(message, 'loading', { ...options, persistent: true });
  }
}

// Initialize toast manager
const toastManager = new ToastManager();

// Add event listeners
startButton.addEventListener('click', startConversation);
stopButton.addEventListener('click', () => stopConversation(true)); // Show toast for manual stop

// Keyboard navigation
document.addEventListener('keydown', handleKeyboardNavigation);

// Enhanced keyboard navigation for toasts
document.addEventListener('keydown', (event) => {
  // ESC key to close all toasts
  if (event.key === 'Escape') {
    const visibleToasts = document.querySelectorAll('.toast.show');
    if (visibleToasts.length > 0) {
      // Close all toasts with ESC
      toastManager.hideAll();
      event.preventDefault();
    }
  }

  // Focus management for toast close buttons
  if (event.key === 'Tab') {
    const activeToasts = document.querySelectorAll('.toast.show');
    activeToasts.forEach(toast => {
      const closeBtn = toast.querySelector('.toast-close');
      if (closeBtn && !closeBtn.hasAttribute('tabindex')) {
        closeBtn.setAttribute('tabindex', '0');
      }
    });
  }
});

// Cleanup on page unload (silent - no toast)
window.addEventListener('beforeunload', () => stopConversation(false));