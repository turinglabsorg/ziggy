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

        /* the story image: full width, blended into the sky top and bottom */
        #__ID__-photo { position: absolute; left: 0; right: 0; top: __PHOTO_TOP__px; height: __PHOTO_H__px; overflow: hidden;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14%, #000 86%, transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, #000 14%, #000 86%, transparent 100%); }
        #__ID__-photo-img { display: block; width: 100%; height: 100%; object-fit: cover; }
        #__ID__-photo-shade { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(__BG_RGB__, 0.15), rgba(__BG_RGB__, 0) 40%, rgba(__BG_RGB__, 0.35)); }

        /* content column — title-safe for Reels: nothing above __PAD_TOP__ or below the footer */
        #__ID__-content { position: absolute; left: __PAD__px; right: __PAD__px; top: __PAD_TOP__px; bottom: __PAD_BOTTOM__px; display: flex; flex-direction: column; }
        #__ID__-kicker { margin: 0; font-family: var(--mono); font-weight: 500; font-size: __KICKER__px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 18px; }
        #__ID__-kicker .k-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
        #__ID__-spacer { flex: 0 0 __SPACER__px; }
        #__ID__-headline { margin: 0; font-family: var(--display); font-weight: 400; font-size: __HEADLINE__px; line-height: 1.12; letter-spacing: -0.012em; color: var(--fg); }
        #__ID__-headline .w { display: inline-block; margin-right: 0.26em; }
        #__ID__-dek { margin: __DEK_MT__px 0 28px; font-family: var(--text); font-weight: 300; font-size: __DEK__px; line-height: 1.42; color: var(--fg); opacity: 0.84; max-width: __DEK_MAX__px; }
        #__ID__-footer { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; border-top: 1px solid var(--line); padding-top: 26px; }
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
          <div id="__ID__-stars">__STARS__</div>
          <div id="__ID__-photo" style="display: __PHOTO_DISPLAY__" data-layout-allow-overflow="true"><img id="__ID__-photo-img" src="__IMAGE_SRC__" alt="" /><div id="__ID__-photo-shade"></div></div>
          <div id="__ID__-content">
            <p id="__ID__-kicker"><span class="k-dot"></span><span id="__ID__-kicker-text">__COPY_KICKER__</span></p>
            <div id="__ID__-spacer"></div>
            <h1 id="__ID__-headline">__HEADLINE_WORDS__</h1>
            <p id="__ID__-dek">__COPY_DEK__</p>
            <div id="__ID__-footer">
              <p id="__ID__-meta">__COPY_META__</p>
              <div>
                <span id="__ID__-brand">__BRAND_PARTS____BRAND_DOT__</span>
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

          function build() {
            var tl = gsap.timeline({ paused: true });
            var soft = "power2.out", hard = "power4.out";

            /* stars arrive, then breathe */
            var starEls = Array.prototype.slice.call(document.querySelectorAll("#" + ID + "-stars .star"));
            starEls.forEach(function (el, i) {
              var d = STARS[i];
              tl.fromTo(el, { opacity: 0 }, { opacity: d.base, duration: 0.8, ease: soft }, 0.1 + d.phase * 0.9);
              var cycle = (DUR - 1.9) / d.cycles;
              tl.to(el, { opacity: Math.max(0.08, d.base - d.amp), duration: cycle / 2, ease: "sine.inOut", yoyo: true, repeat: d.cycles * 2 - 1 }, 1.9);
            });

            /* photo: fade in, slow push in across the whole piece */
            if (HAS_PHOTO) {
              tl.fromTo($("photo-img"), { opacity: 0, scale: 1.1 }, { opacity: 1, scale: 1.1, duration: 1.1, ease: soft }, 0.2);
              tl.to($("photo-img"), { scale: 1.0, duration: DUR - 1.3, ease: "none" }, 1.3);
            }

            /* kicker */
            tl.fromTo($("kicker"), { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.7, ease: soft }, 0.6);

            /* headline, word by word */
            var words = document.querySelectorAll("#" + ID + "-headline .w");
            tl.fromTo(words, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.75, ease: hard, stagger: 0.055 }, 1.3);

            /* dek */
            tl.fromTo($("dek"), { autoAlpha: 0, y: 20 }, { autoAlpha: 0.84, y: 0, duration: 0.8, ease: soft }, 1.3 + words.length * 0.055 + 0.5);

            /* footer: meta, brand, url + sweep */
            var footAt = Math.min(DUR - 3.2, 1.3 + words.length * 0.055 + 2.2);
            tl.fromTo($("meta"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, footAt);
            tl.fromTo($("brand"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, footAt + 0.15);
            tl.fromTo($("url"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: soft }, footAt + 0.35);
            tl.fromTo($("url-line"), { scaleX: 0, transformOrigin: "right center" }, { scaleX: 1, duration: 0.7, ease: "power3.inOut" }, footAt + 0.45);

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
