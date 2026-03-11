/**
 * Notification Manager - Event-based notification system
 * Maintains a notification queue, emits events, and auto-generates
 * notifications from store events (session/workspace lifecycle).
 */

const { EventEmitter } = require('events');
const { getStore } = require('../state/store');

const MAX_QUEUE_SIZE = 50;

class NotificationManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Array<{ id: number, level: string, title: string, message: string, timestamp: string }>} */
    this._queue = [];
    this._nextId = 1;
    this._storeListenersAttached = false;
  }

  /**
   * Push a notification to the queue and emit a 'notification' event.
   * @param {'info'|'success'|'warning'|'error'} level - Notification severity
   * @param {string} title - Short notification title
   * @param {string} message - Notification body
   * @returns {object} The notification object
   */
  notify(level, title, message) {
    const notification = {
      id: this._nextId++,
      level,
      title,
      message,
      timestamp: new Date().toISOString(),
    };

    this._queue.push(notification);

    // Trim queue to max size
    if (this._queue.length > MAX_QUEUE_SIZE) {
      this._queue = this._queue.slice(-MAX_QUEUE_SIZE);
    }

    this.emit('notification', notification);
    return notification;
  }

  /**
   * Get the most recent N notifications.
   * @param {number} [count=10] - Number of notifications to return
   * @returns {object[]}
   */
  getRecent(count = 10) {
    return this._queue.slice(-count);
  }

  /**
   * Clear all notifications.
   */
  clear() {
    this._queue = [];
    this.emit('cleared');
  }

  /**
   * Get total notification count.
   * @returns {number}
   */
  get count() {
    return this._queue.length;
  }

  /**
   * Attach listeners to the store to auto-generate notifications
   * for session and workspace lifecycle events.
   */
  attachStoreListeners() {
    if (this._storeListenersAttached) return;

    const store = getStore();

    store.on('session:created', (session) => {
      this.notify('info', 'Session Created', `"${session.displayName || session.name}" added to workspace`);
    });

    store.on('session:updated', (session) => {
      if (session.status === 'running') {
        this.notify('success', 'Session Started', `"${session.displayName || session.name}" is now running (PID: ${session.pid})`);
      } else if (session.status === 'stopped') {
        this.notify('info', 'Session Stopped', `"${session.displayName || session.name}" has stopped`);
      } else if (session.status === 'error') {
        this.notify('error', 'Session Error', `"${session.displayName || session.name}" encountered an error`);
      }
    });

    store.on('session:deleted', ({ id }) => {
      this.notify('warning', 'Session Deleted', `Session ${id.slice(0, 8)} was removed`);
    });

    store.on('workspace:created', (workspace) => {
      this.notify('success', 'Workspace Created', `"${workspace.name}" workspace is ready`);
    });

    store.on('workspace:deleted', ({ id }) => {
      this.notify('warning', 'Workspace Deleted', `Workspace ${id.slice(0, 8)} was removed`);
    });

    store.on('workspace:activated', (workspace) => {
      this.notify('info', 'Workspace Switched', `Active workspace: "${workspace.name}"`);
    });

    store.on('error', ({ type, error }) => {
      this.notify('error', 'Store Error', `${type}: ${error}`);
    });

    this._storeListenersAttached = true;
  }

  /**
   * Detach from the store and clean up.
   */
  destroy() {
    this.removeAllListeners();
    this._queue = [];
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton NotificationManager instance.
 * @returns {NotificationManager}
 */
function getNotificationManager() {
  if (!instance) {
    instance = new NotificationManager();
    instance.attachStoreListeners();
  }
  return instance;
}

module.exports = { NotificationManager, getNotificationManager };
