<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <title>__NAME__ — intro (__ID__, __W__×__H__)</title>
  </head>
  <body>
    <template>
      <style>
__FONT_FACES__
        #root {
          --bg: __BG__; --fg: __FG__; --accent: __ACCENT__;
          --hot: __HOT__; --hot-mid: __HOT_MID__; --hot-deep: __HOT_DEEP__;
          --display: "__DISPLAY_FAMILY__", sans-serif; --text: "__TEXT_FAMILY__", sans-serif; --mono: "__MONO_FAMILY__", monospace;
          position: absolute; inset: 0; overflow: hidden; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased;
        }
        #root *, #root *::before, #root *::after { box-sizing: border-box; }

        /* the studio-logo intro: story illustrations as a red duotone flipbook (act 1), the same
           pages seen through the letters of the wordmark as the camera pulls back (act 2), then
           the letters turn white in a drawn box over a red gradient (act 3). Duotone = the image's
           luminosity over the brand's hot red, no filters */
        .duo { background-size: cover, cover; background-position: center, center; background-blend-mode: luminosity; }

        #__ID__-book { position: absolute; inset: 0; perspective: 1700px; overflow: hidden; }
        #__ID__-book .page { position: absolute; inset: 0; backface-visibility: hidden; }

        #__ID__-red { position: absolute; inset: 0; opacity: 0; background: radial-gradient(120% 70% at 50% 42%, var(--hot-mid) 0%, var(--hot-deep) 78%); }

        #__ID__-logo { position: absolute; left: 0; right: 0; top: __LOGO_TOP__px; display: flex; flex-direction: column; align-items: center; }
        #__ID__-word { position: relative; padding: 0.06em 0.16em 0.02em; opacity: 0; }
        #__ID__-word .w { font-family: var(--display); font-weight: 800; font-size: __WORD_SIZE__px; line-height: 1; letter-spacing: -0.02em; text-transform: uppercase; white-space: nowrap; }
        #__ID__-word .w-size { visibility: hidden; display: block; }
        #__ID__-word .cut { position: absolute; inset: 0; padding: inherit; opacity: 0; color: transparent; -webkit-background-clip: text; background-clip: text; }
        #__ID__-word .white { position: absolute; inset: 0; padding: inherit; opacity: 0; color: var(--fg); }
        #__ID__-word .edge { position: absolute; background: var(--fg); }
        #__ID__-word .edge.top { left: 0; right: 0; top: 0; height: __EDGE__px; }
        #__ID__-word .edge.right { top: 0; bottom: 0; right: 0; width: __EDGE__px; }
        #__ID__-word .edge.bottom { left: 0; right: 0; bottom: 0; height: __EDGE__px; }
        #__ID__-word .edge.left { top: 0; bottom: 0; left: 0; width: __EDGE__px; }

        #__ID__-sub { margin: __SUB_MT__px 0 0; font-family: var(--mono); font-weight: 500; font-size: __SUB_SIZE__px; letter-spacing: 0.62em; padding-left: 0.62em; text-transform: uppercase; color: var(--fg); opacity: 0; }
        #__ID__-tagline { margin: __TAG_MT__px 0 0; max-width: __TAG_MAX__px; text-align: center; font-family: var(--text); font-weight: 700; font-size: __TAG__px; line-height: 1.3; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg); opacity: 0; }
        #__ID__-url { position: absolute; left: 0; right: 0; bottom: __URL_BOTTOM__px; display: flex; justify-content: center; opacity: 0; }
        #__ID__-url .u-wrap { display: inline-flex; flex-direction: column; align-items: stretch; }
        #__ID__-url .u { font-family: var(--mono); font-weight: 500; font-size: __URL__px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--fg); }
        #__ID__-url .u-line { display: block; width: 100%; height: 3px; margin-top: 10px; background: var(--accent); }
      </style>

      <div id="root" data-composition-id="__ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
__AUDIO__
        <div id="__ID__-book" data-layout-allow-overflow="true">
__PAGES__
        </div>
        <div id="__ID__-red"></div>
        <div id="__ID__-logo">
          <div id="__ID__-word" data-layout-allow-overflow="true">
            <span class="w w-size" aria-hidden="true">__COPY_WORD__</span>
__CUTS__
            <span class="w white">__COPY_WORD__</span>
            <i class="edge top"></i><i class="edge right"></i><i class="edge bottom"></i><i class="edge left"></i>
          </div>
          <p id="__ID__-sub">__COPY_SUB__</p>
          <p id="__ID__-tagline">__COPY_TAGLINE__</p>
        </div>
        <div id="__ID__-url"><span class="u-wrap"><span class="u">__URL_TEXT__</span><span class="u-line"></span></span></div>
      </div>

      <script>
        (function () {
          var ID = "__ID__";
          var $ = function (s) { return document.getElementById(ID + "-" + s); };
          var DUR = __DUR__;

          function build() {
            if (window.__timelines[ID]) { window.__timelines[ID].kill(); }
            var tl = gsap.timeline({ paused: true });
            var q = function (sel) { return Array.prototype.slice.call(document.querySelectorAll("#" + ID + "-" + sel)); };

            /* act 1 — pages fall toward the viewer, faster and faster, under a slow push in */
            var pages = q("book .page");
            var t = 0.25;
            tl.fromTo($("book"), { scale: 1.0 }, { scale: 1.12, duration: 4.4, ease: "none" }, 0);
            pages.forEach(function (p, i) {
              if (i === pages.length - 1) return;
              var d = Math.max(0.09, 0.55 * Math.pow(0.82, i));
              tl.fromTo(p, { rotationX: 0, transformOrigin: "50% 100%" }, { rotationX: -96, duration: d * 0.92, ease: "power2.in" }, t);
              t += d;
            });
            var tPull = Math.min(t, 4.4);

            /* act 2 — the camera pulls back: the pages keep cutting inside the letters */
            var word = $("word");
            tl.set(word, { opacity: 1 }, tPull - 0.05);
            tl.fromTo(word, { scale: 7, rotation: -8 }, { scale: 1, rotation: 0, duration: 1.35, ease: "power3.inOut" }, tPull - 0.05);
            tl.to($("book"), { autoAlpha: 0, duration: 0.5, ease: "power1.in" }, tPull + 0.1);
            var cuts = q("word .cut");
            var step = 0.11, tc = tPull - 0.05, k = 0;
            while (tc < tPull + 1.3 && cuts.length) {
              tl.set(cuts, { opacity: 0 }, tc);
              tl.set(cuts[k % cuts.length], { opacity: 1 }, tc);
              tc += step; k++;
            }

            /* act 3 — red gradient, the letters turn white, a box draws itself, then the rest */
            var t3 = tPull + 1.1;
            tl.to($("red"), { opacity: 1, duration: 1.0, ease: "power1.out" }, tPull + 0.2);
            tl.to(q("word .white"), { opacity: 1, duration: 0.5, ease: "power2.out" }, t3);
            tl.to(cuts, { opacity: 0, duration: 0.3 }, t3 + 0.35);
            var edges = [["top", "scaleX", "0% 50%"], ["right", "scaleY", "50% 0%"], ["bottom", "scaleX", "100% 50%"], ["left", "scaleY", "50% 100%"]];
            edges.forEach(function (e, i) {
              var from = {}; from[e[1]] = 0; from.transformOrigin = e[2];
              var to = {}; to[e[1]] = 1; to.duration = 0.2; to.ease = "none";
              tl.fromTo(word.querySelector(".edge." + e[0]), from, to, t3 + 0.45 + i * 0.2);
            });
            tl.fromTo($("sub"), { opacity: 0, filter: "brightness(4) blur(6px)" }, { opacity: 1, filter: "brightness(1) blur(0px)", duration: 0.7, ease: "power2.out" }, t3 + 1.3);
            tl.fromTo($("tagline"), { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, t3 + 2.0);
            tl.fromTo($("url"), { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power2.out" }, t3 + 2.7);
            tl.fromTo(q("url .u-line"), { scaleX: 0, transformOrigin: "50% 50%" }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, t3 + 2.8);

            tl.seek(0);
            window.__timelines[ID] = tl;
            if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
          }

          if (document.fonts && document.fonts.ready) document.fonts.ready.then(build); else build();
        })();
      </script>
    </template>
  </body>
</html>
