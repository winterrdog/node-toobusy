[![Build Status](https://secure.travis-ci.org/winterrdog/node-toobusy.png)](http://travis-ci.org/winterrdog/node-toobusy)

# Is Your Node Process Too Busy?

`toobusy-js-v1` is a fork of lloyd's [node-toobusy](http://github.com/lloyd/node-toobusy) that removes native dependencies in favor of using the `unref` introduced in [node 0.9.1](http://blog.nodejs.org/2012/08/28/node-v0-9-1-unstable/).

This fork was got from Samuel Reed's [node-toobusy](https://github.com/STRML/node-toobusy) repository, and is currently maintained by [winterrdog](https://github.com/winterrdog). I added some improvements to the lag calculation algorithm to be more robust under high load, and to allow for smoother performance degradation( inspired by this [PR](https://github.com/STRML/node-toobusy/pull/17)).

This package is a simpler install without native dependencies, but requires node >= 0.9.1.

## Node-Toobusy

What happens when your service is overwhelmed with traffic? Your server can do one of two things:

- Stop working, or...
- Keep serving as many requests as possible

This library helps you do the latter.

## How it works

`toobusy` polls the node.js event loop and keeps track of "lag", which is how long requests wait in node's event queue to be processed.

The library uses a simple algorithm that:

1. **Measures event loop lag** by comparing expected vs actual timer execution times
2. **Applies conservative lag calculation** - only counts lag when execution time significantly exceeds the check interval, resetting to zero for normal operations
3. **Uses adaptive exponential smoothing** - applies different smoothing factors when lag is increasing vs decreasing to prevent sudden spikes from dominating the average while allowing gradual recovery
4. **Implements probabilistic load shedding** - instead of a hard cutoff, the likelihood of being "too busy" increases proportionally as lag exceeds the threshold

When lag crosses a threshold, `toobusy` doesn't always immediately return "_too busy_". Instead, it uses a probabilistic approach where the chance of blocking increases the further lag exceeds the threshold. This provides smoother performance degradation and prevents sudden "cliff" effects under load.

This allows your server to stay _responsive_ under extreme load, and continue serving as many requests as possible.

## Installation

```
npm install toobusy-js-v1
```

## Usage

```javascript
var toobusy = require("toobusy-js-v1"),
  express = require("express");

var app = express();

// middleware which blocks requests when we're too busy
app.use(function (req, res, next) {
  if (toobusy()) {
    res.send(503, "I'm busy right now, sorry.");
  } else {
    next();
  }
});

app.get("/", function (req, res) {
  // processing the request requires some work!
  var i = 0;
  while (i < 1e5) i++;
  res.send("I counted to " + i);
});

var server = app.listen(3000);

process.on("SIGINT", function () {
  server.close();
  // calling .shutdown allows your process to exit normally
  toobusy.shutdown();
  process.exit();
});
```

## Tunable Parameters

The library exposes a few knobs:

`maxLag` - This number represents the maximum amount of time in milliseconds that the event queue is behind, before we consider the process _too busy_.
`interval` - The check interval for measuring event loop lag, in ms.

```javascript
var toobusy = require("toobusy-js-v1");

// Set maximum lag to an aggressive value.
toobusy.maxLag(10);

// Set check interval to a faster value. This will catch more latency spikes
// but may cause the check to be too sensitive.
toobusy.interval(250);

// Get current maxLag or interval setting by calling without parameters.
var currentMaxLag = toobusy.maxLag(),
  interval = toobusy.interval();

toobusy.onLag(function (currentLag) {
  console.log("Event loop lag detected! Latency: " + currentLag + "ms");
});
```

The default `maxLag` value is `70ms`, and the default check interval is `500ms`.

With the improved lag calculation algorithm, this allows a server to run at high CPU utilization while maintaining responsive behavior through gradual load shedding. The probabilistic approach means that at `1.25x` the `maxLag` threshold (`87.5ms`), requests will be rejected `25%` of the time, and at `2x` the threshold (`140ms`), all requests will be rejected.

These numbers are only examples, and the specifics of your hardware and application can change them drastically, so experiment! The default of `70` should get you started.

## Events

As of `0.5.0`, `toobusy-js-v1` exposes an `onLag` method. Pass it a callback to be notified when
a slow event loop tick has been detected.

## References

> There is nothing new under the sun. (Ecclesiastes 1:9)

Though applying "event loop latency" to node.js was not directly inspired by anyone else's work,
this concept is not new. Here are references to others who apply the same technique:

- [Provos, Lever, and Tweedie 2000](http://www.kegel.com/c10k.html#tips) - "notes that dropping incoming connections when the server is overloaded improved the shape of the performance curve."

## license

[WTFPL](http://wtfpl.org)
