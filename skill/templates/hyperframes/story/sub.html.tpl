<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <title>__NAME__ — story (__ID__, __W__×__H__)</title>
  </head>
  <body>
    <template>
      <style>
__FONT_FACES__
        #root {
          --bg: __BG__; --fg: __FG__; --muted: __MUTED__; --line: __LINE__; --accent: __ACCENT__;
          --display: "__DISPLAY_FAMILY__", sans-serif; --text: "__TEXT_FAMILY__", sans-serif; --mono: "__MONO_FAMILY__", monospace;
          position: absolute; inset: 0; overflow: hidden; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased;
        }
        #root *, #root *::before, #root *::after { box-sizing: border-box; }
        #__ID__-stage { position: absolute; inset: 0; }

        #__ID__-stars { position: absolute; inset: 0; pointer-events: none; }
        #__ID__-stars .star { position: absolute; border-radius: 50%; }
        #__ID__-stars .star.fg { background: var(--fg); }
        #__ID__-stars .star.muted { background: var(--muted); }

        /* the story image is big: it fills the top half (cover) and pans slowly across, so a
           landscape illustration is seen nearly whole while its centre never leaves the frame;
           it blends into the sky only at its own bottom edge, above the text zone */
        #__ID__-photo { position: absolute; left: 0; right: 0; top: __PHOTO_TOP__px; height: __PHOTO_H__px; overflow: hidden;
          -webkit-mask-image: linear-gradient(to bottom, #000 62%, transparent 100%); mask-image: linear-gradient(to bottom, #000 62%, transparent 100%); }
        #__ID__-photo-img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: 15% 50%; }
        #__ID__-photo-shade { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(__BG_RGB__, 0.35), rgba(__BG_RGB__, 0.08) 40%, rgba(__BG_RGB__, 0.45)); }

        /* content column — title-safe for Reels: nothing above __PAD_TOP__ or below the footer */
        #__ID__-content { position: absolute; left: __PAD__px; right: __PAD__px; top: __PAD_TOP__px; bottom: __PAD_BOTTOM__px; display: flex; flex-direction: column; }
        /* the kicker sits over the photo: its own chip keeps 3:1 contrast on any image
           without darkening the illustration */
        #__ID__-kicker { margin: 0; align-self: flex-start; padding: 12px 18px; border-radius: 10px; background: rgba(__BG_RGB__, 0.78); font-family: var(--mono); font-weight: 500; font-size: __KICKER__px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 18px; }
        #__ID__-kicker .k-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
        #__ID__-progress { position: absolute; left: 0; top: 0; width: 100%; height: 4px; background: var(--line); }
        #__ID__-progress-fill { display: block; height: 100%; width: 100%; background: var(--accent); transform: scaleX(0); transform-origin: left center; }
        #__ID__-middle { position: relative; flex: 1; margin: 36px 0 34px; }
        #__ID__-middle .scene { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; }
        #__ID__-middle .scene > * { position: relative; z-index: 1; }

        #__ID__-headline { margin: 0; font-family: var(--display); font-weight: 400; font-size: __HEADLINE__px; line-height: 1.12; letter-spacing: -0.012em; color: var(--fg); }
        #__ID__-headline .w { display: inline-block; margin-right: 0.26em; }
        /* end card: how many sources, then where to read the whole story */
        #__ID__-end-sources { margin: 0; display: __END_SRC_DISPLAY__; align-items: baseline; gap: 24px; }
        #__ID__-end-num { font-family: var(--display); font-weight: 720; font-size: __END_NUM_SIZE__px; line-height: 0.9; letter-spacing: -0.03em; color: var(--accent); }
        #__ID__-end-label { font-family: var(--mono); font-weight: 500; font-size: __END_LABEL_SIZE__px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
        #__ID__-end-cta { margin: 44px 0 0; font-family: var(--display); font-weight: 400; font-size: __PTEXT__px; line-height: 1.2; letter-spacing: -0.01em; color: var(--fg); max-width: __DEK_MAX__px; }
        #__ID__-end-cta .end-site { color: var(--accent); white-space: nowrap; }
        #__ID__-middle .p-num { font-family: var(--display); font-weight: 720; font-size: __PNUM__px; line-height: 1; letter-spacing: -0.02em; color: var(--accent); }
        #__ID__-middle .p-line { width: 72px; height: 3px; margin-top: 16px; background: var(--accent); }
        #__ID__-middle .p-text { margin: 24px 0 0; font-family: var(--display); font-weight: 400; font-size: __PTEXT__px; line-height: 1.22; letter-spacing: -0.01em; color: var(--fg); }

        /* footer: brand mark left, site right — the only brand mention on screen */
        #__ID__-footer { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; border-top: 1px solid var(--line); padding-top: 26px; }
        #__ID__-fleft { display: flex; align-items: center; gap: 22px; }
        #__ID__-flogo { width: __FLOGO__px; height: __FLOGO__px; flex: 0 0 auto; }
        #__ID__-flogo svg { width: 100%; height: 100%; display: block; overflow: visible; }
        #__ID__-meta { margin: 0; font-family: var(--mono); font-weight: 400; font-size: __META__px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); line-height: 1.5; }
        #__ID__-brand { position: relative; display: inline-block; font-family: var(--display); font-size: __BRAND__px; line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; white-space: nowrap; padding-right: 0.5em; }
        #__ID__-brand .part { display: inline-block; }
        #__ID__-brand .part + .part { margin-left: 0.32em; }
        #__ID__-brand .b-dot { position: absolute; top: 0.02em; right: 0.08em; width: 0.15em; height: 0.15em; border-radius: 50%; background: var(--accent); }
        #__ID__-url { display: block; margin-top: 12px; font-family: var(--mono); font-weight: 500; font-size: __META__px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg); text-align: right; }
        #__ID__-url-line { display: block; height: 2px; width: 100%; margin-top: 8px; background: var(--accent); }
      </style>

      <div id="root" data-composition-id="__ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
__AUDIO__
        <div id="__ID__-stage">
          <div id="__ID__-progress"><span id="__ID__-progress-fill"></span></div>
          <div id="__ID__-stars">__STARS__</div>
          <div id="__ID__-photo" style="display: __PHOTO_DISPLAY__" data-layout-allow-overflow="true"><img id="__ID__-photo-img" src="__IMAGE_SRC__" alt="" /><div id="__ID__-photo-shade"></div></div>
          <div id="__ID__-content">
            <p id="__ID__-kicker"><span class="k-dot"></span><span id="__ID__-kicker-text">__COPY_KICKER__</span></p>
            <div id="__ID__-middle">
              <div class="scene" id="__ID__-s0"><h1 id="__ID__-headline">__HEADLINE_WORDS__</h1></div>
__POINTS__
              <div class="scene close-scene" id="__ID__-sclose"><p id="__ID__-end-sources"><span id="__ID__-end-num">__END_NUM__</span><span id="__ID__-end-label">__END_LABEL__</span></p><p id="__ID__-end-cta">__END_CTA__</p></div>
            </div>
            <div id="__ID__-footer">
              <div id="__ID__-fleft">
                <span id="__ID__-flogo">__MARK_SVG__</span>
                <span id="__ID__-brand">__BRAND_PARTS____BRAND_DOT__</span>
                <p id="__ID__-meta">__COPY_META__</p>
              </div>
              <div>
                <span id="__ID__-url">__COPY_URL__<span id="__ID__-url-line"></span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        (function () {
          var ID = "__ID__";
          var $ = function (s) { return document.getElementById(ID + "-" + s); };
          var STARS = __STARS_JSON__;
          var DUR = __DUR__;
          var HAS_PHOTO = __HAS_PHOTO__;
          var PN = __POINT_N__;

          function build() {
            /* idempotent: the runtime may mount this composition more than once — kill a
               previous build so its tweens never stack with ours on the same elements */
            if (window.__timelines[ID]) { window.__timelines[ID].kill(); }
            var tl = gsap.timeline({ paused: true });
            var soft = "power2.out", hard = "power4.out";

            /* scene budget: title slide, one slide per point, a close slide with the dek —
               each point needs ~4s+ to stay readable */
            var tTitle = 5, tClose = 4;
            var tPoint = PN > 0 ? Math.max(3.6, (DUR - tTitle - tClose) / PN) : 0;

            /* footer: the mark svg wins over the text wordmark when the brand has one */
            var flogo = $("flogo");
            var hasLogo = !!flogo.querySelector("svg");
            $("brand").style.display = hasLogo ? "none" : "";
            flogo.style.display = hasLogo ? "" : "none";

            /* progress bar across the whole piece */
            tl.fromTo($("progress-fill"), { scaleX: 0 }, { scaleX: 1, duration: DUR - 0.6, ease: "none" }, 0.3);

            /* stars arrive, then breathe */
            var starEls = Array.prototype.slice.call(document.querySelectorAll("#" + ID + "-stars .star"));
            starEls.forEach(function (el, i) {
              var d = STARS[i];
              tl.fromTo(el, { opacity: 0 }, { opacity: d.base, duration: 0.8, ease: soft }, 0.1 + d.phase * 0.9);
              var cycle = (DUR - 1.9) / d.cycles;
              tl.to(el, { opacity: Math.max(0.08, d.base - d.amp), duration: cycle / 2, ease: "sine.inOut", yoyo: true, repeat: d.cycles * 2 - 1 }, 1.9);
            });

            /* photo: fade in, slow push in and a pan across the whole piece */
            if (HAS_PHOTO) {
              tl.fromTo($("photo-img"), { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1.08, duration: 1.1, ease: soft }, 0.2);
              tl.to($("photo-img"), { scale: 1.0, duration: DUR - 1.3, ease: "none" }, 1.3);
              tl.fromTo($("photo-img"), { objectPosition: "15% 50%" }, { objectPosition: "85% 50%", duration: DUR - 0.4, ease: "sine.inOut" }, 0.2);
            }

            /* kicker + counter */
            tl.fromTo($("kicker"), { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.7, ease: soft }, 0.6);

            /* scene 0: the headline, word by word */
            var s0 = $("s0");
            tl.fromTo(s0, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 1.15);
            var words = document.querySelectorAll("#" + ID + "-headline .w");
            tl.fromTo(words, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.75, ease: hard, stagger: 0.055 }, 1.3);
            tl.to(s0, { autoAlpha: 0, y: -22, duration: 0.4, ease: "power2.in" }, tTitle - 0.35);

            /* scenes 1..PN: one point per slide */
            for (var i = 0; i < PN; i++) {
              var tS = tTitle + i * tPoint;
              var sc = $("s" + (i + 1));
              if (!sc) continue;
              tl.fromTo(sc, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: soft }, tS);
              tl.fromTo(sc.querySelector(".p-num"), { scale: 0.55, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6, ease: hard }, tS + 0.1);
              tl.fromTo(sc.querySelector(".p-line"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.6, ease: "power3.inOut" }, tS + 0.4);
              tl.to(sc, { autoAlpha: 0, y: -20, duration: 0.4, ease: "power2.in" }, tS + tPoint - 0.35);
            }

            /* close scene: the source count, then where to read the whole story — held to the end */
            var tC = tTitle + PN * tPoint;
            tl.fromTo($("sclose"), { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, tC);
            tl.fromTo($("end-num"), { scale: 0.55, autoAlpha: 0, transformOrigin: "left bottom" }, { scale: 1, autoAlpha: 1, duration: 0.6, ease: hard }, tC + 0.1);
            tl.fromTo($("end-cta"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, tC + 0.55);

            /* footer: persistent — meta, mark, url + sweep */
            tl.fromTo($("meta"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, 1.4);
            tl.fromTo(hasLogo ? flogo : $("brand"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, 1.55);
            tl.fromTo($("url"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: soft }, 1.75);
            tl.fromTo($("url-line"), { scaleX: 0, transformOrigin: "right center" }, { scaleX: 1, duration: 0.7, ease: "power3.inOut" }, 1.85);

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
