<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <title>__NAME__ — eventi teaser (__ID__, __W__×__H__)</title>
  </head>
  <body>
    <template>
      <style>
__FONT_FACES__
        #root {
          --bg: __BG__; --fg: __FG__; --muted: __MUTED__; --line: __LINE__; --accent: __ACCENT__;
          --sun: __EV_SUN__; --hot: __EV_HOT__; --lime: __EV_LIME__; --sea: __EV_SEA__; --card: __EV_CARD_BG__; --night2: __EV_NIGHT2__;
          --display: "__DISPLAY_FAMILY__", sans-serif; --text: "__TEXT_FAMILY__", sans-serif; --mono: "__MONO_FAMILY__", monospace;
          __EV_VARS__
          position: absolute; inset: 0; overflow: hidden; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased;
        }
        #root *, #root *::before, #root *::after { box-sizing: border-box; }
        #__ID__-stage { position: absolute; inset: 0; }
        #__ID__-glow { position: absolute; inset: 0; background:
          radial-gradient(70% 42% at 92% 4%, var(--card) 0%, rgba(__BG_RGB__, 0) 100%),
          radial-gradient(80% 40% at 0% 100%, var(--night2) 0%, rgba(__BG_RGB__, 0) 100%); }

        /* title-safe box: below padTop, above the footer */
        #__ID__-content { position: absolute; left: var(--v-pad-x); right: var(--v-pad-x); top: var(--v-pad-top); bottom: calc(var(--v-pad-bottom) + var(--v-foot) * 1.3 + 52px); }
        .tz-scene { position: absolute; left: 0; right: 0; top: 0; visibility: hidden; }
        .tz-scene .w { display: inline-block; white-space: nowrap; }
        .tz-scene .hl { color: var(--accent); }

        /* the calendar: a month of days with no dates, something on every one */
        #__ID__-grid { position: absolute; left: 50%; bottom: 0; width: calc(var(--v-cell) * 7 + var(--v-cell-gap) * 6); margin-left: calc((var(--v-cell) * 7 + var(--v-cell-gap) * 6) / -2); display: grid; grid-template-columns: repeat(7, var(--v-cell)); grid-auto-rows: var(--v-cell); gap: var(--v-cell-gap); }
        .tz-cell { position: relative; border-radius: calc(var(--v-cell) * 0.16); border: 1px solid var(--line); background: rgba(__BG_RGB__, 0.6); }
        .tz-ring { position: absolute; inset: -1px; border-radius: inherit; border: 3px solid var(--accent); opacity: 0; visibility: hidden; }
        .tz-cdot { position: absolute; left: 50%; top: 50%; width: calc(var(--v-cell) * 0.18); height: calc(var(--v-cell) * 0.18); margin: calc(var(--v-cell) * -0.09) 0 0 calc(var(--v-cell) * -0.09); border-radius: 50%; }
        .tz-cdot.tone-sun { background: var(--sun); } .tz-cdot.tone-hot { background: var(--hot); } .tz-cdot.tone-lime { background: var(--lime); } .tz-cdot.tone-sea { background: var(--sea); }

        /* 1. the hook */
        #__ID__-hook { margin: 0; font-family: var(--display); font-weight: 800; font-size: var(--v-hook); line-height: 1.06; letter-spacing: -0.04em; color: var(--fg); text-wrap: balance; }

        /* 2. what the calendar holds, and where */
        #__ID__-lead { margin: 0; font-family: var(--display); font-weight: 720; font-size: var(--v-lead); line-height: 1.1; letter-spacing: -0.015em; color: var(--fg); }
        #__ID__-words { position: relative; height: calc(var(--v-word) * 1.18); margin-top: 6px; overflow: hidden; }
        .tz-word { position: absolute; left: 0; top: 0; font-family: var(--display); font-weight: 800; font-size: var(--v-word); line-height: 1.1; letter-spacing: -0.04em; white-space: nowrap; visibility: hidden; }
        .tz-word.tone-sun { color: var(--sun); } .tz-word.tone-hot { color: var(--hot); } .tz-word.tone-lime { color: var(--lime); } .tz-word.tone-sea { color: var(--sea); }
        #__ID__-province { margin: calc(var(--v-word) * 0.5) 0 0; display: flex; align-items: center; gap: 14px; font-family: var(--mono); font-weight: 500; font-size: calc(var(--v-town) * 0.46); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
        #__ID__-province .k-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
        /* the towns run past, full bleed: the track is twice the list so the loop never shows a seam */
        #__ID__-ticker { position: relative; margin: 18px calc(var(--v-pad-x) * -1) 0; height: calc(var(--v-town) * 1.4); overflow: hidden; }
        #__ID__-track { position: absolute; left: var(--v-pad-x); top: 0; display: flex; align-items: center; white-space: nowrap; }
        .tz-town { font-family: var(--display); font-weight: 720; font-size: var(--v-town); line-height: 1.4; letter-spacing: -0.02em; color: var(--fg); }
        .tz-sep { display: inline-block; width: calc(var(--v-town) * 0.22); height: calc(var(--v-town) * 0.22); margin: 0 calc(var(--v-town) * 0.45); border-radius: 50%; background: var(--accent); }

        /* 3. every day */
        #__ID__-daily { margin: 0; font-family: var(--display); font-weight: 800; font-size: var(--v-daily); line-height: 1.06; letter-spacing: -0.035em; color: var(--fg); text-wrap: balance; }

        /* 4. where */
        #__ID__-cta { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; visibility: hidden; }
        /* the last frame is the ad's end card: the question, then the answer */
        #__ID__-cta-hook { margin: 0; font-family: var(--display); font-weight: 800; font-size: calc(var(--v-cta-lead) * 1.5); line-height: 1.04; letter-spacing: -0.03em; color: var(--fg); }
        #__ID__-cta-hook .w { display: inline-block; white-space: nowrap; }
        #__ID__-cta-hook .hl { color: var(--accent); }
        #__ID__-cta-rule { display: block; width: 100%; height: 1px; margin: 56px 0 52px; background: var(--line); }
        #__ID__-cta-mark { width: calc(var(--v-cta-url) * 1.1); height: calc(var(--v-cta-url) * 1.1); margin-bottom: 40px; }
        #__ID__-cta-mark svg { width: 100%; height: 100%; display: block; overflow: visible; }
        #__ID__-cta-lead { margin: 0; font-family: var(--display); font-weight: 720; font-size: var(--v-cta-lead); line-height: 1.1; letter-spacing: -0.015em; color: var(--fg); }
        #__ID__-cta-box { width: 100%; margin-top: 18px; }
        #__ID__-cta-url { display: inline-block; font-family: var(--display); font-weight: 800; font-size: var(--v-cta-url); line-height: 1.05; letter-spacing: -0.03em; color: var(--accent); white-space: nowrap; }
        #__ID__-cta-line { display: block; height: 8px; width: 100%; margin-top: 14px; border-radius: 4px; background: var(--accent); }
        #__ID__-propose { margin: 56px 0 0; max-width: 92%; font-family: var(--text); font-weight: 400; font-size: var(--v-propose); line-height: 1.35; color: var(--muted); }

        #__ID__-foot { position: absolute; left: var(--v-pad-x); right: var(--v-pad-x); bottom: var(--v-pad-bottom); display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-top: 22px; visibility: hidden; }
        #__ID__-foot-line { position: absolute; left: 0; right: 0; top: 0; height: 1px; background: var(--line); }
        #__ID__-fleft { display: flex; align-items: center; gap: 18px; }
        #__ID__-flogo { width: calc(var(--v-foot) * 1.3); height: calc(var(--v-foot) * 1.3); flex: 0 0 auto; }
        #__ID__-flogo svg { width: 100%; height: 100%; display: block; overflow: visible; }
        #__ID__-brand { font-family: var(--display); font-size: var(--v-foot); line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; white-space: nowrap; color: var(--fg); }
        #__ID__-brand .part { display: inline-block; white-space: pre; }
        #__ID__-furl { font-family: var(--mono); font-weight: 500; font-size: calc(var(--v-foot) * 0.66); letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg); }
      </style>

      <div id="root" data-composition-id="__ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
__AUDIO__
        <div id="__ID__-stage">
          <div id="__ID__-glow"></div>
          <div id="__ID__-content">
            <div id="__ID__-grid">__EV_GRID__</div>

            <div class="tz-scene" id="__ID__-s-hook"><h1 id="__ID__-hook">__EV_HOOK_WORDS__</h1></div>

            <div class="tz-scene" id="__ID__-s-what">
              <p id="__ID__-lead">__COPY_LEAD__</p>
              <div id="__ID__-words" data-layout-allow-overflow="true">__EV_WORDS__</div>
              <p id="__ID__-province"><span class="k-dot"></span><span>__COPY_PROVINCE__</span></p>
              <div id="__ID__-ticker" data-layout-allow-overflow="true"><div id="__ID__-track" data-layout-allow-overflow="true">__EV_TOWNS__</div></div>
            </div>

            <div class="tz-scene" id="__ID__-s-daily"><h2 id="__ID__-daily">__EV_DAILY_WORDS__</h2></div>

            <div id="__ID__-cta">
              <p id="__ID__-cta-hook">__EV_HOOK_WORDS__</p>
              <span id="__ID__-cta-rule"></span>
              <span id="__ID__-cta-mark">__MARK_SVG__</span>
              <p id="__ID__-cta-lead">__COPY_CTA__</p>
              <div id="__ID__-cta-box"><span id="__ID__-cta-url">__COPY_URL__<span id="__ID__-cta-line"></span></span></div>
              <p id="__ID__-propose">__COPY_PROPOSE__</p>
            </div>
          </div>

          <div id="__ID__-foot">
            <span id="__ID__-foot-line"></span>
            <div id="__ID__-fleft">
              <span id="__ID__-flogo">__MARK_SVG__</span>
              <span id="__ID__-brand">__BRAND_PARTS__</span>
            </div>
            <span id="__ID__-furl">__COPY_URL__</span>
          </div>
        </div>
      </div>

      <script>
        (function () {
          var ID = "__ID__";
          var $ = function (s) { return document.getElementById(ID + "-" + s); };
          var DUR = __DUR__;
          var WN = __EV_WORD_N__;

          function fit() {
            var url = $("cta-url"), box = $("cta-box");
            var us = parseFloat(url.getAttribute("data-size") || getComputedStyle(url).fontSize);
            url.setAttribute("data-size", us);
            url.style.fontSize = us + "px";
            while (url.getBoundingClientRect().width > box.clientWidth && us > 36) { us -= 2; url.style.fontSize = us + "px"; }
          }

          function build() {
            if (window.__timelines[ID]) { window.__timelines[ID].kill(); }
            fit();
            var tl = gsap.timeline({ paused: true });
            var soft = "power2.out", hard = "power4.out";
            var q = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
            var tA = 0, tB = 3.2, tC = 7.5, tD = 10.1;

            tl.fromTo($("glow"), { opacity: 0 }, { opacity: 1, duration: 1.2, ease: soft }, 0);
            tl.fromTo($("foot"), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, 0.25);
            tl.fromTo($("foot-line"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.8, ease: "power3.inOut" }, 0.35);

            /* the calendar fills up: cells, then a dot on each day in a fixed shuffled order */
            var cells = q("#" + ID + "-grid .tz-cell");
            var dots = q("#" + ID + "-grid .tz-cdot");
            var rings = q("#" + ID + "-grid .tz-ring");
            tl.fromTo(cells, { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: soft, stagger: { each: 0.018, from: "start" } }, 0.2);
            var order = dots.map(function (_, i) { return i; });
            var seed = 7;
            for (var k = order.length - 1; k > 0; k--) { seed = (seed * 9301 + 49297) % 233280; var j = Math.floor((seed / 233280) * (k + 1)); var tmp = order[k]; order[k] = order[j]; order[j] = tmp; }
            order.forEach(function (idx, n) {
              tl.fromTo(dots[idx], { scale: 0 }, { scale: 1, duration: 0.35, ease: "back.out(3)" }, 0.7 + n * 0.07);
            });

            /* 1. hook */
            tl.fromTo($("s-hook"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "none" }, tA + 0.1);
            tl.fromTo(q("#" + ID + "-hook .w"), { yPercent: 80, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.65, ease: hard, stagger: 0.09 }, tA + 0.2);
            tl.to($("s-hook"), { autoAlpha: 0, y: -40, duration: 0.35, ease: "power2.in" }, tB - 0.35);

            /* 2. concerti, mostre, teatro, sagre — across the province */
            tl.fromTo($("s-what"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "none" }, tB);
            tl.fromTo($("lead"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tB + 0.05);
            var span = (tC - tB - 0.6) / Math.max(1, WN);
            for (var i = 0; i < WN; i++) {
              var w = $("word-" + i);
              var tw = tB + 0.2 + i * span;
              tl.fromTo(w, { autoAlpha: 0, yPercent: 100 }, { autoAlpha: 1, yPercent: 0, duration: 0.4, ease: hard }, tw);
              if (i < WN - 1) tl.to(w, { autoAlpha: 0, yPercent: -100, duration: 0.3, ease: "power2.in" }, tw + span - 0.3);
            }
            tl.fromTo($("province"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tB + 0.45);
            tl.fromTo($("ticker"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: soft }, tB + 0.55);
            var half = $("track").scrollWidth / 2;
            tl.fromTo($("track"), { x: 0 }, { x: -half * 0.55, duration: tC - tB, ease: "none" }, tB);
            tl.to($("s-what"), { autoAlpha: 0, y: -40, duration: 0.35, ease: "power2.in" }, tC - 0.35);

            /* 3. aggiornato ogni giorno: the days tick by, one after the other */
            tl.fromTo($("s-daily"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "none" }, tC);
            tl.fromTo(q("#" + ID + "-daily .w"), { yPercent: 80, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: hard, stagger: 0.09 }, tC + 0.05);
            rings.forEach(function (r, n) {
              var tr = tC + 0.3 + n * 0.055;
              tl.fromTo(r, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, ease: "none" }, tr);
              tl.to(r, { autoAlpha: 0, duration: 0.3, ease: "none" }, tr + 0.2);
            });
            tl.to($("s-daily"), { autoAlpha: 0, y: -40, duration: 0.35, ease: "power2.in" }, tD - 0.35);
            tl.to($("grid"), { autoAlpha: 0, y: 40, duration: 0.45, ease: "power2.in" }, tD - 0.4);

            /* 4. the address, held to the end */
            tl.fromTo($("cta"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: "none" }, tD);
            tl.fromTo($("cta-hook"), { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tD);
            tl.fromTo($("cta-rule"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.6, ease: "power3.inOut" }, tD + 0.1);
            tl.fromTo($("cta-mark"), { autoAlpha: 0, scale: 0.6, rotation: -30 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.7, ease: hard }, tD + 0.1);
            tl.fromTo($("cta-lead"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tD + 0.15);
            tl.fromTo($("cta-url"), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: hard }, tD + 0.3);
            tl.fromTo($("cta-line"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.7, ease: "power3.inOut" }, tD + 0.65);
            tl.fromTo($("propose"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tD + 0.95);

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
