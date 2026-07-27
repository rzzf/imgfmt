export default function browserRuntime() {
  "use strict";

  var documentSurface = arguments[0];
  var ImageConstructor = arguments[1];
  var setTimer = arguments[2];
  var clearTimer = arguments[3];
  var configuration = arguments[4];
  var attribute = configuration.attribute;
  var pending = configuration.pending;
  var root = documentSurface.documentElement;

  if (!root || root.getAttribute(attribute) !== pending) {
    return;
  }

  var formats = configuration.formats;
  var probes = configuration.probes;
  var capabilities = [];
  var settled = [];
  var images = [];
  var remaining = probes.length;
  var committed = false;
  var timer = null;
  var index;

  for (index = 0; index < formats.length; index += 1) {
    capabilities[index] = true;
  }

  function dimensionsMatch(image, probe) {
    var width = typeof image.naturalWidth === "number" ? image.naturalWidth : image.width;
    var height = typeof image.naturalHeight === "number" ? image.naturalHeight : image.height;

    return width === probe.width && height === probe.height;
  }

  function commit() {
    if (committed) {
      return;
    }

    committed = true;

    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }

    var tokens = [configuration.ready];

    for (var formatIndex = 0; formatIndex < formats.length; formatIndex += 1) {
      if (capabilities[formatIndex]) {
        tokens.push(formats[formatIndex]);
      }
    }

    if (root.getAttribute(attribute) === pending) {
      root.setAttribute(attribute, tokens.join(" "));
    }
  }

  function settle(probeIndex, supported) {
    if (committed || settled[probeIndex]) {
      return;
    }

    settled[probeIndex] = true;
    remaining -= 1;

    var image = images[probeIndex];

    if (image) {
      image.onload = null;
      image.onerror = null;
      image.onabort = null;
      images[probeIndex] = null;
    }

    if (!supported) {
      capabilities[probes[probeIndex].formatIndex] = false;
    }

    if (remaining === 0) {
      commit();
    }
  }

  function startProbe(probeIndex) {
    var probe = probes[probeIndex];
    var image;

    try {
      image = new ImageConstructor();
      images[probeIndex] = image;
      image.onload = function () {
        settle(probeIndex, dimensionsMatch(image, probe));
      };
      image.onerror = image.onabort = function () {
        settle(probeIndex, false);
      };
      image.src = probe.uri;
    } catch (error) {
      void error;
      settle(probeIndex, false);
    }
  }

  function onDeadline() {
    for (var probeIndex = 0; probeIndex < probes.length; probeIndex += 1) {
      if (!settled[probeIndex]) {
        settle(probeIndex, false);
      }
    }
  }

  timer = setTimer(onDeadline, configuration.deadlineMs);

  for (index = 0; index < probes.length; index += 1) {
    startProbe(index);
  }
}
