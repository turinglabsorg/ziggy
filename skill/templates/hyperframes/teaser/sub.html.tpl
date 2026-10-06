<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <title>__NAME__ — teaser (__ID__, __W__×__H__)</title>
  </head>
  <body>
    <template>
      <style>
__FONT_FACES__
        #root {
          /* palette — from the tenant's brand.json */
          --bg: __BG__;
          --fg: __FG__;
          --muted: __MUTED__;
          --line: __LINE__;
          --accent: __ACCENT__;
          --display: "__DISPLAY_FAMILY__", sans-serif;
          --text: "__TEXT_FAMILY__", sans-serif;
          --mono: "__MONO_FAMILY__", monospace;
          position: absolute; inset: 0; overflow: hidden;
          background: var(--bg); color: var(--fg);
          -webkit-font-smoothing: antialiased;
        }
        #root *, #root *::before, #root *::after { box-sizing: border-box; }
        #__ID__-stage { position: absolute; inset: 0; }

        /* decoratives */
        #__ID__-stars { position: absolute; inset: 0; pointer-events: none; }
        #__ID__-stars .star { position: absolute; border-radius: 50%; }
        #__ID__-stars .star.fg { background: var(--fg); }
        #__ID__-stars .star.muted { background: var(--muted); }

        #__ID__-orbit-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
        #__ID__-orbit-path { fill: none; stroke: var(--muted); stroke-width: 1.5; opacity: 0; }

        #__ID__-orbit { position: absolute; width: 0; height: 0; }
        #__ID__-orbit-ell { position: absolute; left: 0; top: 0; width: 0; height: 0; transform: scaleY(__ORBIT_K__); }
        #__ID__-orbit-rot { position: absolute; left: 0; top: 0; width: 0; height: 0; }
        #__ID__-dot { position: absolute; top: 0; width: 0; height: 0; }
        #__ID__-dot-unsquash { position: absolute; left: 0; top: 0; width: 0; height: 0; transform: scaleY(__ORBIT_INV_K__); }
        #__ID__-dot-core { position: absolute; width: __DOT__px; height: __DOT__px; margin: calc(__DOT__px / -2) 0 0 calc(__DOT__px / -2); border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 rgba(__ACCENT_RGB__, 0); }

        /* content stack — the hero frame is built statically; motion travels to it */
        #__ID__-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: __PAD__px; text-align: center; }
        #__ID__-teaser { position: absolute; left: __PAD__px; right: __PAD__px; top: 50%; margin: 0; font-family: var(--text); font-weight: 300; font-size: __TEASER__px; line-height: 1.3; letter-spacing: 0.005em; color: var(--fg); text-align: center; transform: translateY(-50%); }
        #__ID__-teaser-inner { display: block; }

        #__ID__-logo { width: __LOGO__px; height: __LOGO__px; margin: 0 0 __LOGO_MB__px; }
        #__ID__-logo svg { width: 100%; height: 100%; display: block; overflow: visible; }

        #__ID__-mark { display: flex; flex-direction: __MARK_DIR__; align-items: center; justify-content: center; gap: __MARK_GAP__; font-family: var(--display); font-size: __MARK__px; line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; color: var(--fg); }
        #__ID__-mark .word { display: block; overflow: hidden; padding: 0.08em 0.1em 0.12em; margin: -0.08em -0.1em -0.12em; white-space: nowrap; }
        #__ID__-mark .ch { display: inline-block; }

        #__ID__-tagline { margin: __TAG_MT__px 0 0; max-width: __TAG_MAX__px; font-family: var(--text); font-weight: 300; font-size: __TAG__px; line-height: 1.4; letter-spacing: 0.005em; color: var(--fg); opacity: 0.86; }
        #__ID__-url { position: relative; display: inline-block; margin: __URL_MT__px 0 0; padding-bottom: 10px; font-family: var(--mono); font-weight: 500; font-size: __URL__px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg); }
        #__ID__-url-line { position: absolute; left: 0; right: 0; bottom: 0; display: block; height: 2px; width: 100%; background: var(--accent); }
      </style>

      <div id="root" data-composition-id="__ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
__AUDIO__
        <div id="__ID__-stage">
          <div id="__ID__-stars">__STARS__</div>

          <svg id="__ID__-orbit-svg" viewBox="0 0 __W__ __H__" aria-hidden="true">
            <ellipse id="__ID__-orbit-path" cx="0" cy="0" rx="10" ry="10" />
          </svg>

          <div id="__ID__-content">
            <p id="__ID__-teaser"><span id="__ID__-teaser-inner">__TEASER_TEXT__</span></p>
            <div id="__ID__-logo">__MARK_SVG__</div>
            <div id="__ID__-mark">
__WORDS__
            </div>
            <p id="__ID__-tagline">__TAGLINE__</p>
            <span id="__ID__-url">__URL_TEXT__<span id="__ID__-url-line"></span></span>
          </div>

          <div id="__ID__-orbit">
            <div id="__ID__-orbit-ell">
              <div id="__ID__-orbit-rot">
                <div id="__ID__-dot"><div id="__ID__-dot-unsquash"><div id="__ID__-dot-core"></div></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        (function () {
          var ID = "__ID__";
          var $ = function (s) { return document.getElementById(ID + "-" + s); };
          var K = __ORBIT_K__;
          var STARS = __STARS_JSON__;
          var DUR = __DUR__;
          var ACCENT = "__ACCENT_RGB__";

          function build() {
            var tl = gsap.timeline({ paused: true });
            var ease = { soft: "power2.out", hard: "power4.out", io: "power2.inOut" };

            /* ── geometry: orbit around the wordmark block, landing top-right of the last letter ── */
            var rootEl = $("stage").parentNode;
            var root = rootEl.getBoundingClientRect();
            var mark = $("mark").getBoundingClientRect();
            var last = $("w-last").getBoundingClientRect();
            var cx = mark.left + mark.width / 2 - root.left;
            var cy = mark.top + mark.height / 2 - root.top;
            var em = __MARK__;
            var tx = (last.right - 0.1 * em) + 0.26 * em - (mark.left + mark.width / 2);
            var ty = (last.top + 0.12 * em) + 0.02 * em - (mark.top + mark.height / 2);
            var thetaEnd = Math.atan2(ty / K, tx) * 180 / Math.PI;
            var R = Math.sqrt(tx * tx + (ty / K) * (ty / K));
            var thetaStart = thetaEnd - 270;

            var orbit = $("orbit"); orbit.style.left = cx + "px"; orbit.style.top = cy + "px";
            $("teaser").style.top = cy + "px";
            $("dot").style.left = R + "px";
            var path = $("orbit-path");
            path.setAttribute("cx", cx); path.setAttribute("cy", cy); path.setAttribute("rx", R); path.setAttribute("ry", R * K);

            /* ── 0.0–1.8  stars arrive, then breathe until the end ── */
            var starEls = Array.prototype.slice.call(document.querySelectorAll("#" + ID + "-stars .star"));
            starEls.forEach(function (el, i) {
              var d = STARS[i];
              tl.fromTo(el, { opacity: 0 }, { opacity: d.base, duration: 0.8, ease: ease.soft }, 0.1 + d.phase * 0.9);
              var cycle = (DUR - 1.9) / d.cycles;
              tl.to(el, { opacity: Math.max(0.08, d.base - d.amp), duration: cycle / 2, ease: "sine.inOut", yoyo: true, repeat: d.cycles * 2 - 1 }, 1.9);
            });

            /* ── 0.4–3.6  the accent dot orbits the (still unseen) centre ── */
            tl.fromTo($("dot-core"), { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.6, ease: ease.soft }, 0.45);
            tl.fromTo($("orbit-rot"), { rotation: thetaStart }, { rotation: thetaEnd, duration: 3.2, ease: ease.io }, 0.4);
            /* counter-rotate the anchor in sync so the un-squash cancels the orbit's scaleY exactly: S·R·R⁻¹·S⁻¹ = I */
            tl.fromTo($("dot"), { rotation: -thetaStart }, { rotation: -thetaEnd, duration: 3.2, ease: ease.io }, 0.4);
            tl.fromTo(path, { opacity: 0 }, { opacity: 0.35, duration: 0.9, ease: ease.soft }, 0.8);
            tl.to(path, { opacity: 0, duration: 0.6, ease: "power2.in" }, 3.1);

            /* ── 1.0–3.3  teaser line ── */
            tl.fromTo($("teaser-inner"), { autoAlpha: 0, y: 18, filter: "blur(10px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.9, ease: ease.soft }, 1.0);
            tl.to($("teaser-inner"), { autoAlpha: 0, y: -16, duration: 0.45, ease: "power2.in" }, 2.85);

            /* ── 3.2  the logo mark blooms in, then sways gently until the end ── */
            var logoEl = $("logo");
            if (logoEl.querySelector("svg")) {
              tl.fromTo(logoEl, { autoAlpha: 0, scale: 0.3, rotation: -16 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.75, ease: "back.out(2)" }, 3.2);
              tl.to(logoEl, { rotation: 3, duration: 1.8, ease: "sine.inOut", yoyo: true, repeat: -1 }, 4.2);
            } else {
              logoEl.style.display = "none";
            }

            /* ── 3.4–4.4  wordmark reveal, letter by letter through a mask ── */
            var chars = document.querySelectorAll("#" + ID + "-mark .ch");
            tl.fromTo(chars, { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.85, ease: ease.hard, stagger: 0.04 }, 3.4);

            /* the dot lands and blooms, then breathes */
            tl.to($("dot-core"), { boxShadow: "0 0 36px 6px rgba(" + ACCENT + ", 0.55)", scale: 1.18, duration: 0.35, ease: "sine.inOut", yoyo: true, repeat: 1 }, 3.6);
            tl.to($("dot-core"), { boxShadow: "0 0 22px 2px rgba(" + ACCENT + ", 0.35)", duration: 1.2, ease: "sine.inOut", yoyo: true, repeat: 1 }, 4.6);

            /* ── 4.5  tagline ── */
            tl.fromTo($("tagline"), { autoAlpha: 0, y: 22 }, { autoAlpha: 0.86, y: 0, duration: 0.8, ease: ease.soft }, 4.5);

            /* ── 5.4  url + underline sweep, then hold (skipped when the campaign drops the url) ── */
            var urlEl = $("url");
            if (urlEl.textContent.trim()) {
              tl.fromTo(urlEl, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: ease.soft }, 5.4);
              tl.fromTo($("url-line"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.7, ease: "power3.inOut" }, 5.55);
            } else {
              urlEl.style.display = "none";
            }

            tl.seek(0);
            window.__timelines[ID] = tl;
            if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
          }

          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(build);
          } else {
            build();
          }
        })();
      </script>
    </template>
  </body>
</html>
