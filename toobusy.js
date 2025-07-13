// @ts-check
"use strict";

let events = require("node:events");

//
// Constants
//
const STANDARD_HIGHWATER = 70;
const STANDARD_INTERVAL = 500;
const LAG_EVENT = "LAG_EVENT";

// A dampening factor.  When determining average calls per second or
// current lag, we weigh the current value against the previous value 2:1
// to smooth spikes.
// See https://en.wikipedia.org/wiki/Exponential_smoothing
const SMOOTHING_FACTOR = 1 / 3;

//
// Vars
//

let lastCheckedTime,
  highWater = STANDARD_HIGHWATER,
  interval = STANDARD_INTERVAL,
  smoothingFactor = SMOOTHING_FACTOR,
  currentLag = 0,
  checkInterval,
  lagEventThreshold = -1,
  eventEmitter = new events.EventEmitter();

/**
 * Main export function.
 * @return {Boolean} True if node process is too busy.
 */
var toobusy = function () {
  // start monitoring if not already started
  if (!checkInterval) {
    start();
    return false; // say false on first call since we just started
  }

  if (currentLag <= 0) return false;

  // If current lag is < 2x the highwater mark, we don't always call it 'too busy'. E.g. with a 50ms lag
  // and a 40ms highWater (1.25x highWater), 25% of the time we will block. With 80ms lag and a 40ms highWater,
  // we will always block.
  if (currentLag <= highWater) return false;

  let highWaterLagRatio = (currentLag - highWater) / highWater;
  return Math.random() < Math.min(highWaterLagRatio, 1);
};

/**
 * Sets or gets the current check interval.
 * If you want more sensitive checking, set a faster (lower) interval. A lower maxLag can also create a more
 * sensitive check.
 * @param  {Number} [newInterval] New interval to set. If not provided, will return the existing interval.
 * @return {Number}               New or existing interval.
 */
toobusy.interval = function (newInterval) {
  if (arguments.length === 0) return interval;
  if (typeof newInterval !== "number")
    throw new Error("Interval must be a number.");

  newInterval = Math.round(newInterval);
  if (newInterval < 16)
    throw new Error("Interval should be greater than 16ms.");

  // only restart if interval actually changed
  if (newInterval !== interval) {
    interval = newInterval;
    currentLag = 0; // Always reset lag when interval changes
    if (checkInterval) {
      start(); // Restart monitoring with new interval
    }
  }

  return interval;
};

/**
 * Returns last lag reading from last check interval.
 * @return {Number} Lag in ms.
 */
toobusy.lag = function () {
  return Math.round(currentLag);
};

/**
 * Set or get the current max latency threshold. Default is 70ms.
 *
 * Note that if event loop lag goes over this threshold, the process is not always 'too busy' - the farther
 * it goes over the threshold, the more likely the process will be considered too busy.
 *
 * The percentage is equal to the percent over the max lag threshold. So 1.25x over the maxLag will indicate
 * too busy 25% of the time. 2x over the maxLag threshold will indicate too busy 100% of the time.
 * @param  {Number} [newLag] New maxLag (highwater) threshold.
 * @return {Number}          New or existing maxLag (highwater) threshold.
 */
toobusy.maxLag = function (newLag) {
  if (arguments.length === 0) return highWater;

  // If an arg was passed, try to set highWater.
  if (typeof newLag !== "number") throw new Error("MaxLag must be a number.");
  newLag = Math.round(newLag);
  if (newLag < 10) throw new Error("Maximum lag should be greater than 10ms.");

  highWater = newLag;
  return highWater;
};

/**
 * Set or get the smoothing factor. Default is 0.3333....
 *
 * The smoothing factor per the standard exponential smoothing formula "αtn + (1-α)tn-1"
 * See: https://en.wikipedia.org/wiki/Exponential_smoothing
 *
 * @param  {Number} [newFactor] New smoothing factor.
 * @return {Number}             New or existing smoothing factor.
 */
toobusy.smoothingFactor = function (newFactor) {
  if (arguments.length === 0) return smoothingFactor;
  if (typeof newFactor !== "number")
    throw new Error("NewFactor must be a number.");
  if (newFactor <= 0 || newFactor > 1)
    throw new Error("Smoothing factor should be in range ]0,1].");

  smoothingFactor = newFactor;
  return smoothingFactor;
};

/**
 * Shuts down toobusy.
 *
 * Not necessary to call this manually, only do this if you know what you're doing. `unref()` is called
 * on toobusy's check interval, so it will never keep the server open.
 */
toobusy.shutdown = function () {
  currentLag = 0;
  lastCheckedTime = undefined;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  eventEmitter.removeAllListeners(LAG_EVENT);
  lagEventThreshold = -1;
};

toobusy.started = function () {
  return checkInterval != null;
};

/**
 * Reset the internal lag counter.
 * Useful for testing or when you want to start fresh.
 */
toobusy.reset = function () {
  currentLag = 0;
  if (checkInterval) lastCheckedTime = process.hrtime.bigint();
};

/**
 * Registers an event listener for lag events,
 * optionally specify a minimum value threshold for events being emitted
 * @param {(value: number) => void}  fn  Function of form onLag(value: number) => void
 * @param {number}  [threshold=maxLag] Optional minimum lag value for events to be emitted
 */
toobusy.onLag = function (fn, threshold) {
  if (typeof fn !== "function") {
    throw new Error("Lag event handler must be a function.");
  }
  if (typeof threshold === "number") {
    lagEventThreshold = threshold;
  } else {
    lagEventThreshold = toobusy.maxLag();
  }
  eventEmitter.on(LAG_EVENT, fn);

  // make sure monitoring is started if not already running
  if (!checkInterval) {
    start();
  }
};

/**
 * Starts the lag monitoring process by initializing a timer that periodically checks for lag.
 *
 * The function sets up an interval that:
 * 1. Calculates the lag between expected and actual execution times
 * 2. Applies smoothing to the lag values to prevent sudden spikes from skewing the average
 * 3. Updates the current lag using a weighted average
 * 4. Emits a lag event if the lag exceeds the configured threshold
 *
 * The interval is set to not keep the process open by itself (using unref()).
 *
 * @private
 * @fires module:toobusy#lag when lag exceeds the lagEventThreshold
 */
function start() {
  lastCheckedTime = process.hrtime.bigint(); // used high-resolution time for a more accurate lag measurement
  checkInterval && clearInterval(checkInterval);
  currentLag = 0; // reset lag when starting

  const cb = function monitorLag() {
    let now = process.hrtime.bigint();
    let responseDelayMs = Number(now - lastCheckedTime) / 1e6;
    responseDelayMs = Math.max(0, responseDelayMs - interval); //actual lag

    let factor = smoothingFactor;
    if (responseDelayMs < currentLag) {
      // we don't want sudden spikes to affect the average, so dampen
      // the lag if it is less than the current lag. This is to
      // prevent the lag from dropping too quickly.
      factor = 1 - smoothingFactor;
    }

    // Dampen lag. See SMOOTHING_FACTOR initialization at the top of this file.
    currentLag =
      factor * Math.min(responseDelayMs, highWater * 2) +
      (1 - factor) * currentLag;

    lastCheckedTime = now;

    if (lagEventThreshold > 0 && currentLag > lagEventThreshold) {
      setImmediate(function () {
        // avoid blocking the interval during the timers phase
        eventEmitter.emit(LAG_EVENT, Math.round(currentLag));
      });
    }
  };

  checkInterval = setInterval(cb, interval);

  // Don't keep process open just for this timer.
  checkInterval.unref();
}

// Kickoff the checking!
start();

module.exports = toobusy;
