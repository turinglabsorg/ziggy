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
          --bg: __BG__; --card: __CARD__; --fg: __FG__; --muted: __MUTED__; --accent: __ACCENT__;
          --display: "__DISPLAY_FAMILY__", sans-serif; --text: "__TEXT_FAMILY__", sans-serif; --mono: "__MONO_FAMILY__", monospace;
          position: absolute; inset: 0; overflow: hidden; color: var(--fg); -webkit-font-smoothing: antialiased;
          background: radial-gradient(120% 75% at 50% 42%, var(--card) 0%, var(--bg) 72%);
        }
        #root *, #root *::before, #root *::after { box-sizing: border-box; }

        /* act 1 — a wall of story illustrations, 3 to a row, turned on the diagonal and big enough
           to leave no gaps. Four identical grids take turns: rows slide in from alternating sides,
           then hard cuts tighten into a burst that ghosts and softens before the brand */
        #__ID__-pages { position: absolute; inset: 0; transform: rotate(__PAGES_ROT__deg); transform-origin: 50% 50%; }
        #__ID__-pages .grid { position: absolute; inset: 0; opacity: 0; }
        #__ID__-pages .row { position: absolute; left: __GRID_LEFT__px; display: flex; gap: __GAP__px; }
        #__ID__-pages .panel { position: relative; flex: 0 0 auto; width: __CELL_W__px; height: __CELL_H__px; overflow: hidden; border-radius: 16px; border: 1px solid rgba(__FG_RGB__, 0.16); }
        #__ID__-pages .panel .img { position: absolute; inset: 0; background-size: cover; background-position: center; }
        #__ID__-preload { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; opacity: 0.01; }
        #__ID__-preload img { width: 1px; height: 1px; }
        #__ID__-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(130% 85% at 50% 50%, transparent 55%, rgba(__BG_RGB__, 0.6) 100%); }
        /* grows behind the wordmark as it firms up, so it always reads over the panels */
        #__ID__-scrim { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: radial-gradient(70% 26% at 50% __SCRIM_Y__%, rgba(__BG_RGB__, 0.92) 0%, rgba(__BG_RGB__, 0.55) 55%, transparent 100%), radial-gradient(48% 7% at 50% __SCRIM_URL_Y__%, rgba(__BG_RGB__, 0.92) 0%, rgba(__BG_RGB__, 0.5) 60%, transparent 100%); }

        /* the brand, as it is: mark, wordmark, claim and site — there from the start as a ghost
           that firms up, then the real ones take over */
        #__ID__-logo, #__ID__-ghost { position: absolute; left: 0; right: 0; top: __LOGO_TOP__px; display: flex; flex-direction: column; align-items: center; opacity: 0; }
        #root .mark { width: __MARK_SIZE__px; height: __MARK_SIZE__px; margin-bottom: 38px; }
        #root .mark svg { width: 100%; height: 100%; display: block; }
        #root .wordmark { margin: 0; font-family: var(--display); font-size: __WM_SIZE__px; line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; white-space: nowrap; color: var(--fg); }
        #root .tagline { margin: 54px 0 0; max-width: __TAG_MAX__px; text-align: center; font-family: var(--text); font-weight: 400; font-size: __TAG__px; line-height: 1.32; color: var(--fg); }
        #root .url { position: absolute; left: 0; right: 0; bottom: __URL_BOTTOM__px; display: flex; justify-content: center; opacity: 0; }
        #root .url .u-wrap { display: inline-flex; flex-direction: column; align-items: stretch; }
        #root .url .u { font-family: var(--mono); font-weight: 500; font-size: __URL__px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--fg); }
        #root .url .u-line { display: block; height: 3px; margin-top: 10px; background: var(--accent); }
      </style>

      <div id="root" data-composition-id="__ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
__AUDIO__
        <div id="__ID__-preload" aria-hidden="true" data-layout-ignore>__PRELOAD__</div>
        <div id="__ID__-pages" data-layout-allow-overflow="true">
__PAGES__
        </div>
        <div id="__ID__-vignette"></div>
        <div id="__ID__-scrim"></div>
        <!-- the ghosts build up with the crescendo; set dressing, the real text replaces them -->
        <div id="__ID__-ghost" aria-hidden="true" data-layout-ignore>
          <span class="mark">__MARK_SVG__</span>
          <p class="wordmark">__BRAND_PARTS__</p>
          <p class="tagline">__COPY_TAGLINE__</p>
        </div>
        <div class="url" id="__ID__-ghost-url" aria-hidden="true" data-layout-ignore><span class="u-wrap"><span class="u">__URL_TEXT__</span><span class="u-line"></span></span></div>
        <div id="__ID__-logo">
          <span class="mark" id="__ID__-mark">__MARK_SVG__</span>
          <p class="wordmark" id="__ID__-wordmark">__BRAND_PARTS__</p>
          <p class="tagline" id="__ID__-tagline">__COPY_TAGLINE__</p>
        </div>
        <div class="url" id="__ID__-url"><span class="u-wrap"><span class="u">__URL_TEXT__</span><span class="u-line"></span></span></div>
      </div>

      <script>
        (function () {
          var ID = "__ID__";
          var $ = function (s) { return document.getElementById(ID + "-" + s); };
          var W = __W__;
          var DUR = __DUR__;

          function build() {
            if (window.__timelines[ID]) { window.__timelines[ID].kill(); }
            var tl = gsap.timeline({ paused: true });
            var soft = "power2.out";

            Array.prototype.slice.call(document.querySelectorAll("#" + ID + "-ghost .mark, #" + ID + "-logo .mark")).forEach(function (m) {
              if (!m.querySelector("svg")) m.style.display = "none";
            });

            /* act 1, sized to the piece: four grids take turns. First the rows slide in from
               alternating sides, each page shorter than the last; within about two seconds hard
               cuts take over and tighten to ~15 a second, each grid snapping in sideways. Over the
               last stretch pages come in fainter, travel further and fade under the next ones
               (ghost trails) while the whole wall softens */
            var IMGS = __IMAGES_JSON__;
            var grids = Array.prototype.slice.call(document.querySelectorAll("#" + ID + "-pages .grid"));
            var rowsOf = grids.map(function (g) { return Array.prototype.slice.call(g.querySelectorAll(".row")); });
            var imgsOf = grids.map(function (g) { return Array.prototype.slice.call(g.querySelectorAll(".img")); });
            var act1 = Math.max(4, DUR - 3.25);
            var OFF = Math.round(Math.hypot(W, __H__) + __GRID_W__);
            var z = 1, cur = -1, p = 0, t = 0.15, d = 0.6;
            function fill(gi, page, at) {
              imgsOf[gi].forEach(function (el, k) { tl.set(el, { backgroundImage: "url(" + IMGS[(page * 7 + k) % IMGS.length] + ")" }, at); });
            }
            function dirOf(r, page) { return (r + page) % 2 === 0 ? -1 : 1; }
            while (IMGS.length && d > 0.2 && t < act1 * 0.35) {
              var gi = p % grids.length, prev = cur;
              fill(gi, p, t);
              tl.set(grids[gi], { opacity: 1, zIndex: ++z }, t);
              rowsOf[gi].forEach(function (row, r) {
                var dir = dirOf(r, p), lag = r * 0.025;
                tl.set(row, { x: dir * OFF }, t);
                tl.to(row, { x: 0, duration: d * 0.5, ease: "power3.out" }, t + lag);
                tl.to(row, { x: -dir * 36, duration: d * 0.6, ease: "none" }, t + lag + d * 0.5);
              });
              if (prev >= 0) {
                rowsOf[prev].forEach(function (row, r) { tl.to(row, { x: -dirOf(r, p - 1) * OFF, duration: d * 0.45, ease: "power3.in" }, t); });
                tl.set(grids[prev], { opacity: 0 }, t + d * 0.5);
              }
              cur = gi; t += d; d *= 0.78; p++;
            }
            var dc = 0.16, ghostLen = Math.min(3, act1 * 0.45), ghostFrom = act1 - ghostLen;
            tl.fromTo($("pages"), { filter: "blur(0px)" }, { filter: "blur(5px)", duration: ghostLen, ease: "power1.in", immediateRender: false }, ghostFrom);
            while (IMGS.length && t < act1) {
              var keep = t + dc >= act1;
              var g = t > ghostFrom ? Math.min(1, (t - ghostFrom) / ghostLen) : 0;
              var gi2 = p % grids.length, prev2 = cur;
              fill(gi2, p, t);
              tl.set(grids[gi2], { opacity: 1 - 0.55 * g, zIndex: ++z }, t);
              rowsOf[gi2].forEach(function (row, r) {
                var dir = dirOf(r, p);
                tl.set(row, { x: dir * (120 + 260 * g) }, t);
                tl.to(row, { x: 0, duration: Math.min(dc, 0.12) + 0.3 * g, ease: "power2.out" }, t);
              });
              if (prev2 >= 0) {
                // a grid comes back every fourth cut: its fade must be over by then
                if (g > 0) tl.to(grids[prev2], { opacity: 0, duration: Math.min(dc * (1 + 4 * g), dc * 2.8), ease: "none" }, t);
                else tl.set(grids[prev2], { opacity: 0 }, t + dc * 0.5);
              }
              cur = gi2; t += dc; dc = Math.max(0.065, dc * 0.94); p++;
              if (keep) break;
            }
            var tLogo = t - 0.15;

            /* every line of text is there almost at once — brand, claim, site — as ghosts that are
               readable within a second and firm up by mid-crescendo */
            var ghosts = [$("ghost"), $("ghost-url")], logo = $("logo");
            var tFirm = Math.max(1.6, tLogo * 0.45);
            tl.fromTo(ghosts, { opacity: 0, filter: "blur(10px)", scale: 1.02 }, { opacity: 0.6, filter: "blur(2px)", scale: 1.01, duration: 0.8, ease: soft }, 0.15);
            tl.to(ghosts, { opacity: 0.92, filter: "blur(0.5px)", scale: 1, duration: tFirm - 0.95, ease: "none" }, 0.95);
            tl.fromTo($("scrim"), { opacity: 0 }, { opacity: 0.9, duration: tFirm - 0.15, ease: "none" }, 0.15);

            /* act 2: the last page dissolves, the brand settles, then the claim and the site */
            if (cur >= 0) tl.to(grids[cur], { opacity: 0, filter: "blur(12px)", duration: 0.8, ease: "power1.inOut" }, tLogo);
            tl.fromTo(logo, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: soft }, tLogo + 0.3);
            tl.fromTo($("url"), { opacity: 0 }, { opacity: 1, duration: 0.6, ease: soft }, tLogo + 0.4);
            tl.to(ghosts, { opacity: 0, duration: 0.6, ease: soft }, tLogo + 0.3);

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
