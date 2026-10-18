<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <title>__NAME__ — case file radar (__ID__, __W__×__H__)</title>
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

        /* radar grid background - shrunk to free vertical space */
        #__ID__-radar { position: absolute; left: 50%; top: 200px; width: 480px; height: 480px; transform: translateX(-50%); opacity: 0; }
        #__ID__-radar svg { width: 100%; height: 100%; display: block; }
        
        /* case header */
        #__ID__-case-header { position: absolute; left: __PAD__px; right: __PAD__px; top: 120px; display: flex; justify-content: space-between; align-items: center; }
        #__ID__-case-label { font-family: var(--mono); font-size: 22px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
        #__ID__-case-id { font-family: var(--mono); font-size: 18px; font-weight: 500; letter-spacing: 0.08em; color: var(--muted); }

        /* blip marker - adjusted for smaller radar */
        #__ID__-blip { position: absolute; left: 50%; top: 440px; width: 28px; height: 28px; transform: translate(-50%, -50%); opacity: 0; }
        #__ID__-blip-outer { position: absolute; inset: 0; border: 3px solid var(--accent); border-radius: 50%; }
        #__ID__-blip-inner { position: absolute; inset: 7px; background: var(--accent); border-radius: 50%; }
        #__ID__-blip-label { position: absolute; top: 34px; left: 50%; transform: translateX(-50%); white-space: nowrap; font-family: var(--mono); font-size: 14px; font-weight: 600; letter-spacing: 0.08em; color: var(--accent); }
        #__ID__-blip-status { position: absolute; top: 52px; left: 50%; transform: translateX(-50%); white-space: nowrap; font-family: var(--mono); font-size: 12px; color: var(--muted); }

        /* content panel with flow layout - starts after smaller radar */
        #__ID__-content { position: absolute; left: __PAD__px; right: __PAD__px; top: 760px; max-height: 980px; overflow: hidden; display: flex; flex-direction: column; }
        
        #__ID__-headline { margin: 0 0 18px; font-family: var(--display); font-weight: 600; font-size: __CF_HEADLINE__px; line-height: 1.1; letter-spacing: -0.015em; color: var(--fg); }
        #__ID__-dek { margin: 0 0 26px; font-family: var(--text); font-weight: 400; font-size: __CF_DEK__px; line-height: 1.35; color: var(--muted); }

        /* readouts wrapped in container - compact spacing */
        #__ID__-readouts { margin: 0 0 18px; }
        .cf-readout { margin-bottom: 20px; opacity: 0; }
        .cf-readout-label { font-family: var(--mono); font-size: __CF_LABEL__px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
        .cf-readout-bar { height: 4px; background: rgba(__ACCENT_RGB__, 0.15); border-radius: 2px; margin-bottom: 8px; overflow: hidden; }
        .cf-readout-fill { height: 100%; background: var(--accent); width: 0%; }
        .cf-readout-text { font-family: var(--text); font-weight: 400; font-size: __CF_POINT__px; line-height: 1.3; color: var(--fg); margin: 0; }

        /* photo inset in corner of radar - doesn't block text */
        #__ID__-photo-wrapper { position: absolute; right: __PAD__px; top: 320px; max-width: 340px; display: __PHOTO_DISPLAY__; z-index: 15; }
        #__ID__-photo-border { position: relative; background: #fff; padding: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3); transform: rotate(2.5deg); }
        #__ID__-photo { width: 100%; max-height: 200px; object-fit: contain; display: block; }
        /* credit: on the white border, inset past the bottom corner tapes (≈56px square once rotated) and above them */
        #__ID__-photo-credit { margin: 6px 60px 2px; font-family: var(--mono); font-size: 9px; font-weight: 400; color: #555555; text-align: center; font-style: italic; position: relative; z-index: 17; }
        
        /* masking tape strips */
        .tape { position: absolute; background: rgba(230, 223, 200, 0.75); box-shadow: inset 0 0 3px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1); z-index: 16; }
        #__ID__-tape1 { width: 60px; height: 20px; left: -5px; top: 15px; transform: rotate(-45deg); }
        #__ID__-tape2 { width: 60px; height: 20px; right: -5px; top: 15px; transform: rotate(45deg); }
        #__ID__-tape3 { width: 60px; height: 20px; left: -5px; bottom: 15px; transform: rotate(45deg); display: __PHOTO_DISPLAY__; }
        #__ID__-tape4 { width: 60px; height: 20px; right: -5px; bottom: 15px; transform: rotate(-45deg); display: __PHOTO_DISPLAY__; }

        /* footer */
        #__ID__-footer { position: absolute; left: __PAD__px; right: __PAD__px; bottom: 80px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding-top: 22px; z-index: 10; }
        #__ID__-brand { font-family: var(--display); font-size: 36px; line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; color: var(--fg); position: relative; }
        #__ID__-brand .part { display: inline-block; }
        #__ID__-brand .part + .part { margin-left: 0.3em; }
        #__ID__-source { font-family: var(--mono); font-size: __CF_SOURCE_SIZE__px; font-weight: 400; color: var(--muted); max-width: 420px; text-align: right; }
        #__ID__-url { display: block; margin-top: 8px; font-family: var(--mono); font-size: 18px; font-weight: 500; color: var(--accent); text-align: right; }
      </style>

      <div id="root" data-composition-id="__ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
__AUDIO__
        <div id="__ID__-stage">
          <div id="__ID__-radar">
            <svg viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- grid lines -->
              <line x1="0" y1="400" x2="800" y2="400" stroke="__LINE__" stroke-width="1" />
              <line x1="400" y1="0" x2="400" y2="800" stroke="__LINE__" stroke-width="1" />
              <line x1="120" y1="120" x2="680" y2="680" stroke="__LINE__" stroke-width="1" stroke-opacity="0.5" />
              <line x1="680" y1="120" x2="120" y2="680" stroke="__LINE__" stroke-width="1" stroke-opacity="0.5" />
              
              <!-- concentric circles -->
              <circle cx="400" cy="400" r="100" stroke="__LINE__" stroke-width="2" fill="none" />
              <circle cx="400" cy="400" r="200" stroke="__LINE__" stroke-width="2" fill="none" />
              <circle cx="400" cy="400" r="300" stroke="__LINE__" stroke-width="2" fill="none" />
              <circle cx="400" cy="400" r="380" stroke="__ACCENT__" stroke-width="3" fill="none" stroke-opacity="0.3" />
              
              <!-- corner markers -->
              <path d="M20,20 L20,60 M20,20 L60,20" stroke="__ACCENT__" stroke-width="2" stroke-linecap="square" />
              <path d="M780,20 L780,60 M780,20 L740,20" stroke="__ACCENT__" stroke-width="2" stroke-linecap="square" />
              <path d="M20,780 L20,740 M20,780 L60,780" stroke="__ACCENT__" stroke-width="2" stroke-linecap="square" />
              <path d="M780,780 L780,740 M780,780 L740,780" stroke="__ACCENT__" stroke-width="2" stroke-linecap="square" />
            </svg>
          </div>

          <div id="__ID__-blip">
            <div id="__ID__-blip-outer"></div>
            <div id="__ID__-blip-inner"></div>
            <div id="__ID__-blip-label">__CF_CASE_NUM__</div>
            <div id="__ID__-blip-status">status: __CF_STATUS__</div>
          </div>

          <div id="__ID__-case-header">
            <div id="__ID__-case-label">CASE FILE</div>
            <div id="__ID__-case-id">__CF_DATE__</div>
          </div>

          <div id="__ID__-content">
            <h1 id="__ID__-headline">__COPY_HEADLINE__</h1>
            <p id="__ID__-dek">__COPY_DEK__</p>

            <div id="__ID__-readouts">
              <div class="cf-readout" id="__ID__-confirmed">
                <div class="cf-readout-label">__CF_LABEL_CONFIRMED__</div>
                <div class="cf-readout-bar"><div class="cf-readout-fill" id="__ID__-confirmed-fill"></div></div>
                <p class="cf-readout-text">__CF_CONFIRMED__</p>
              </div>

              <div class="cf-readout" id="__ID__-notconfirmed">
                <div class="cf-readout-label">__CF_LABEL_NOT_CONFIRMED__</div>
                <div class="cf-readout-bar"><div class="cf-readout-fill" id="__ID__-notconfirmed-fill"></div></div>
                <p class="cf-readout-text">__CF_NOT_CONFIRMED__</p>
              </div>

              <div class="cf-readout" id="__ID__-whymatters">
                <div class="cf-readout-label">__CF_LABEL_WHY_MATTERS__</div>
                <div class="cf-readout-bar"><div class="cf-readout-fill" id="__ID__-whymatters-fill"></div></div>
                <p class="cf-readout-text">__CF_WHY_MATTERS__</p>
              </div>
            </div>
          </div>

          <div id="__ID__-photo-wrapper">
            <div id="__ID__-photo-border">
              <img id="__ID__-photo" src="__IMAGE_SRC__" alt="Case file image" />
              <div id="__ID__-photo-credit" style="display: __PHOTO_CREDIT_DISPLAY__;">__PHOTO_CREDIT__</div>
              <div class="tape" id="__ID__-tape1"></div>
              <div class="tape" id="__ID__-tape2"></div>
              <div class="tape" id="__ID__-tape3"></div>
              <div class="tape" id="__ID__-tape4"></div>
            </div>
          </div>

          <div id="__ID__-footer">
            <span id="__ID__-brand">__BRAND_PARTS__</span>
            <div>
              <div id="__ID__-source">Source: __CF_SOURCE__</div>
              <div id="__ID__-url">__COPY_URL__</div>
            </div>
          </div>
        </div>
      </div>

      <script>
        (function () {
          var ID = "__ID__";
          var $ = function (s) { return document.getElementById(ID + "-" + s); };
          var DUR = __DUR__;

          function build() {
            if (window.__timelines[ID]) { window.__timelines[ID].kill(); }
            var tl = gsap.timeline({ paused: true });
            var soft = "power2.out", hard = "power3.out";

            /* radar grid fades in and pulses subtly */
            tl.fromTo($("radar"), { opacity: 0, scale: 0.9 }, { opacity: 0.4, scale: 1, duration: 1.2, ease: soft }, 0.2);
            tl.to($("radar"), { opacity: 0.25, duration: (DUR - 1.2) / 2, ease: "sine.inOut", yoyo: true, repeat: 1 }, 1.2);

            /* case header */
            tl.fromTo($("case-header"), { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.8, ease: soft }, 0.6);

            /* blip appears with pulse */
            tl.fromTo($("blip"), { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.7, ease: "back.out(2)" }, 1.4);
            tl.fromTo($("blip-outer"), { scale: 1 }, { scale: 1.6, opacity: 0, duration: 1.2, ease: soft, repeat: 2 }, 1.6);

            /* headline and dek */
            tl.fromTo($("headline"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: soft }, 2.2);
            tl.fromTo($("dek"), { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.7, ease: soft }, 2.6);

            /* readouts appear with bar fills */
            var readouts = ["confirmed", "notconfirmed", "whymatters"];
            var fills = [0.75, 0.45, 0.85];
            readouts.forEach(function(id, i) {
              var t = 3.2 + i * 0.8;
              tl.fromTo($(id), { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: soft }, t);
              tl.fromTo($(id + "-fill"), { width: "0%" }, { width: (fills[i] * 100) + "%", duration: 0.9, ease: "power2.out" }, t + 0.2);
            });

            /* photo appears with tape strips (only if photo exists) */
            if ($("photo-wrapper") && getComputedStyle($("photo-wrapper")).display !== "none") {
              tl.fromTo($("photo-border"), { opacity: 0, scale: 0.85, rotateZ: -1.2 }, 
                { opacity: 1, scale: 1, duration: 0.6, ease: soft }, 5.0);
              tl.fromTo($("tape1"), { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, 5.2);
              tl.fromTo($("tape2"), { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, 5.3);
              tl.fromTo($("tape3"), { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, 5.4);
              tl.fromTo($("tape4"), { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, 5.5);
              if ($("photo-credit") && getComputedStyle($("photo-credit")).display !== "none") {
                tl.fromTo($("photo-credit"), { opacity: 0 }, { opacity: 1, duration: 0.4, ease: soft }, 5.6);
              }
            }

            /* footer */
            tl.fromTo($("footer"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: soft }, 5.6);

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
