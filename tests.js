'use strict';
var should = require('should');
var toobusy = require('./');

function tightWork(duration) {
  var start = Date.now();
  while ((Date.now() - start) < duration) {
    for (var i = 0; i < 1e5;) i++;
  }
}

/*global describe, it, beforeEach, afterEach */
describe('the library', function() {
  it('should export a couple functions', function() {
    should(toobusy).be.Function();
    (toobusy.maxLag).should.be.Function();
    (toobusy.shutdown).should.be.Function();
    (toobusy.interval).should.be.Function();
    (toobusy.shutdown).should.be.Function();
    (toobusy).should.not.have.property('start');
  });
  it('should start automatically', function() {
    (toobusy.started()).should.equal(true);
  });
});

describe('maxLag', function() {
  it('should default to 70', function() {
    (toobusy.maxLag()).should.equal(70);
  });
  it('should throw an exception for non-numbers', function() {
    (function() { toobusy.maxLag('derp'); }).should.throw(/must be a number/);
  });
  it('should throw an exception for values < 10', function() {
    (function() { toobusy.maxLag(9); }).should.throw(/should be greater than 10/);
  });
  it('should be configurable', function() {
    (toobusy.maxLag(50)).should.equal(50);
    (toobusy.maxLag(10)).should.equal(10);
    (toobusy.maxLag()).should.equal(10);
  });
});

describe('interval', function() {
  it('should default to 500', function() {
    (toobusy.interval()).should.equal(500);
  });
  it('should throw an exception for values < 16', function() {
    (function() { toobusy.interval(15); }).should.throw(/Interval/);
  });
  it('should be configurable', function() {
    (toobusy.interval(250)).should.equal(250);
    (toobusy.interval(300)).should.equal(300);
    (toobusy.interval()).should.equal(300);
  });
});

describe('toobusy()', function() {
  // Set lower thresholds for each of these tests.
  // Resetting the interval() also resets the internal lag counter, which
  // is nice for making these tests independent of each other.
  beforeEach(function() {
    toobusy.maxLag(10);
    toobusy.interval(50);
  });
  after(function() {
    toobusy.maxLag(70);
    toobusy.interval(500);
  });
  it('should return true after a little load', function(done) {
    function load() {
      if (toobusy()) return done();
      tightWork(100);
      setTimeout(load, 0);
    }
    load();
  });

  it('should return a lag value after a little load', function(done) {
    function load() {
      if (toobusy()) {
        var lag = toobusy.lag();
        should.exist(lag);
        lag.should.be.above(1);
        return done();
      }
      tightWork(100);
      setTimeout(load, 0);
    }
    load();
  });

  describe('lag events', function () {
    it('should not emit lag events if the lag is less than the configured threshold',
        testLagEvent(100, 50, false));
    it('should emit lag events if the lag is greater than the configured threshold',
        testLagEvent(50, 150, true));
    it('should emit lag events if lag occurs and no threshold is specified',
        testLagEvent(undefined, 500, true));

    function testLagEvent(threshold, work, expectFire) {
      return function (done) {
        var calledDone = false;
        var finish = function() {
          if (calledDone) return;
          calledDone = true;
          toobusy.shutdown(); // stops onLag() from firing again
          clearTimeout(workTimeout);
          done.apply(null, arguments);
        };

        toobusy.onLag(function (lag) {
          if (!expectFire) {
            return finish(new Error('lag event fired unexpectedly'));
          }

          should.exist(lag);
          lag.should.be.above(threshold || 0);
          finish();
        }, threshold);

        if (!expectFire) {
          setTimeout(function () {
            finish();
          }, work + threshold);
        }

        // Do work 3x to work around smoothing factor
        var count = 0;
        var workTimeout = setTimeout(function working() {
          tightWork(work);
          if (++count < 3) workTimeout = setTimeout(working);
        })
      }
    }
  });
});

describe('smoothingFactor', function() {
  // Sometimes the default 2s timeout is hit on this suite, raise to 10s.
  this.timeout(10 * 1000);

  beforeEach(function() {
    toobusy.maxLag(10);
    toobusy.interval(250);
  });
  after(function() {
    toobusy.maxLag(70);
    toobusy.interval(500);
  });
  it('should default to 1/3', function() {
    (toobusy.smoothingFactor()).should.equal(1/3);
  });
  it('should throw an exception for invalid values', function() {
    (function() { toobusy.smoothingFactor(0); }).should.throw;
    (function() { toobusy.smoothingFactor(2); }).should.throw;
    (function() { toobusy.smoothingFactor(-1); }).should.throw;
    (function() { toobusy.smoothingFactor(1); }).should.not.throw;
  });
  it('should be configurable', function() {
    (toobusy.smoothingFactor(0.9)).should.equal(0.9);
    (toobusy.smoothingFactor(0.1)).should.equal(0.1);
    (toobusy.smoothingFactor()).should.equal(0.1);
  });
  it('should allow no dampening', function(done) {
    var cycles_to_toobusy = 0;
    toobusy.smoothingFactor(1); // no dampening

    function load() {
      if (toobusy()) {
        (cycles_to_toobusy).should.equal(3);
        return done();
      }
      cycles_to_toobusy++;
      tightWork(100); // in 3 ticks, will overshoot by ~50ms, above 2*10ms
      setImmediate(load);
    }

    load();
  });
  it('should respect larger dampening factors', function(done) {
    var cycles_to_toobusy = 0;
    toobusy.smoothingFactor(0.05);

    function load() {
      if (toobusy()) {
        (cycles_to_toobusy).should.be.above(3);
        return done();
      }
      cycles_to_toobusy++;
      tightWork(100);
      setImmediate(load);
    }

    load();
  });
});

describe('started', function() {
  it('should return false after shutdown', function(done) {
    toobusy.shutdown();
    (toobusy.started()).should.equal(false);
    done();
  });
});


