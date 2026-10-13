<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <title>__NAME__ — case file dossier (__ID__, __W__×__H__)</title>
  </head>
  <body>
    <template>
      <style>
__FONT_FACES__
        #root {
          --bg: __BG__; --fg: __FG__; --muted: __MUTED__; --line: __LINE__; --accent: __ACCENT__;
          --cream: #ece6da; --dark: #07080b; --redact: #1a1a1a;
          --display: "__DISPLAY_FAMILY__", sans-serif; --text: "__TEXT_FAMILY__", sans-serif; --mono: "__MONO_FAMILY__", monospace;
          position: absolute; inset: 0; overflow: hidden; background: var(--dark); color: var(--fg); -webkit-font-smoothing: antialiased;
        }
        #root *, #root *::before, #root *::after { box-sizing: border-box; }
        #__ID__-stage { position: absolute; inset: 0; }

        /* dark background with subtle vignette */
        #__ID__-backdrop { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(20, 20, 20, 0.3) 0%, var(--dark) 70%); }

        /* declassified document sheet: cream paper, slightly rotated on dark */
        #__ID__-sheet { position: absolute; left: 50%; top: 50%; width: 920px; height: 1460px; 
          transform: translate(-50%, -50%) rotate(__ROTATION__deg);
          background: var(--cream); box-shadow: 0 24px 72px rgba(0, 0, 0, 0.8); border-radius: 2px; }

        /* document header */
        #__ID__-doc-header { position: absolute; left: 60px; right: 60px; top: 48px; display: flex; justify-content: space-between; align-items: flex-start; }
        #__ID__-doc-title { font-family: var(--mono); font-size: 18px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: #2a2a2a; }
        #__ID__-doc-date { font-family: var(--mono); font-size: 16px; font-weight: 400; color: #6a6a6a; }

        /* case file label */
        #__ID__-label { position: absolute; left: 60px; top: 100px; padding: 0 0 12px; border-bottom: 2px solid var(--accent); }
        #__ID__-label-text { font-family: var(--mono); font-size: 20px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); }

        /* headline */
        #__ID__-headline { position: absolute; left: 60px; right: 60px; top: 160px; margin: 0; 
          font-family: var(--display); font-weight: 600; font-size: __CF_HEADLINE__px; line-height: 1.12; letter-spacing: -0.015em; color: #0a0a0a; }

        /* dek */
        #__ID__-dek { position: absolute; left: 60px; right: 60px; top: __CF_DEK_TOP__px; margin: 0; 
          font-family: var(--text); font-weight: 400; font-size: __CF_DEK__px; line-height: 1.4; color: #3a3a3a; }

        /* points section with labels */
        #__ID__-points { position: absolute; left: 60px; right: 60px; top: __CF_POINTS_TOP__px; }
        .cf-section { margin-bottom: 32px; }
        .cf-section-label { font-family: var(--mono); font-size: 16px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
        .cf-section-text { font-family: var(--text); font-weight: 400; font-size: __CF_POINT__px; line-height: 1.45; color: #1a1a1a; margin: 0; }

        /* redaction bars */
        .redact-bar { position: absolute; height: 22px; background: var(--redact); opacity: 0; }

        /* withheld stamp - fully opaque with backing for contrast compliance */
        #__ID__-stamp { position: absolute; right: 80px; bottom: 100px; width: 280px; height: 100px;
          background: rgba(255, 255, 255, 0.3); border: 4px solid rgb(180, 25, 10); border-radius: 8px; 
          transform: rotate(-8deg); opacity: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
        #__ID__-stamp-main { font-family: var(--mono); font-size: 26px; font-weight: 700; letter-spacing: 0.12em; color: rgb(140, 20, 5); }
        #__ID__-stamp-sub { font-family: var(--mono); font-size: 13px; font-weight: 500; letter-spacing: 0.08em; color: rgb(110, 15, 3); }

        /* source footer */
        #__ID__-source { position: absolute; left: 60px; right: 60px; bottom: 48px; font-family: var(--mono); font-size: 15px; font-weight: 400; color: #5a5a5a; }

        /* brand footer on dark background */
        #__ID__-footer { position: absolute; left: 0; right: 0; bottom: 60px; display: flex; align-items: center; justify-content: center; gap: 16px; }
        #__ID__-brand { font-family: var(--display); font-size: 34px; line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; color: var(--cream); }
        #__ID__-brand .part { display: inline-block; }
        #__ID__-brand .part + .part { margin-left: 0.28em; }
        #__ID__-url { font-family: var(--mono); font-size: 20px; font-weight: 500; color: var(--accent); letter-spacing: 0.08em; }
      </style>

      <div id="root" data-composition-id="__ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
__AUDIO__
        <div id="__ID__-stage">
          <div id="__ID__-backdrop"></div>
          
          <div id="__ID__-sheet">
            <div id="__ID__-doc-header">
              <div id="__ID__-doc-title">Case file · FOIA __CF_CASE_NUM__</div>
              <div id="__ID__-doc-date">__CF_DATE__</div>
            </div>
            
            <div id="__ID__-label">
              <div id="__ID__-label-text">CASE FILE</div>
            </div>

            <h1 id="__ID__-headline">__COPY_HEADLINE__</h1>
            <p id="__ID__-dek">__COPY_DEK__</p>

            <div id="__ID__-points">
              <div class="cf-section" id="__ID__-confirmed">
                <div class="cf-section-label">CONFIRMED</div>
                <p class="cf-section-text">__CF_CONFIRMED__</p>
              </div>
              <div class="cf-section" id="__ID__-notconfirmed">
                <div class="cf-section-label">NOT CONFIRMED</div>
                <p class="cf-section-text">__CF_NOT_CONFIRMED__</p>
              </div>
              <div class="cf-section" id="__ID__-whymatters">
                <div class="cf-section-label">WHY IT MATTERS</div>
                <p class="cf-section-text">__CF_WHY_MATTERS__</p>
              </div>
            </div>

            <div class="redact-bar" id="__ID__-redact1" style="left: 60px; width: 400px; top: 680px;"></div>
            <div class="redact-bar" id="__ID__-redact2" style="left: 60px; width: 520px; top: 820px;"></div>
            <div class="redact-bar" id="__ID__-redact3" style="right: 80px; width: 360px; top: 960px;"></div>

            <div id="__ID__-stamp" style="display: __CF_STAMP_DISPLAY__;">
              <div id="__ID__-stamp-main">__CF_STAMP_TEXT__</div>
              <div id="__ID__-stamp-sub">__CF_STAMP_SUB__</div>
            </div>

            <div id="__ID__-source">Source: __CF_SOURCE__</div>
          </div>

          <div id="__ID__-footer">
            <span id="__ID__-brand">__BRAND_PARTS__</span>
            <span id="__ID__-url">__COPY_URL__</span>
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

            /* fade in backdrop */
            tl.fromTo($("backdrop"), { opacity: 0 }, { opacity: 1, duration: 0.6, ease: soft }, 0);

            /* sheet appears with subtle rotation wobble */
            tl.fromTo($("sheet"), { scale: 0.85, opacity: 0, rotateZ: "__ROTATION__" }, 
              { scale: 1, opacity: 1, duration: 1.2, ease: "back.out(1.2)" }, 0.3);

            /* document header fades in */
            tl.fromTo($("doc-header"), { opacity: 0 }, { opacity: 1, duration: 0.8, ease: soft }, 1.2);
            tl.fromTo($("label"), { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.6, ease: soft }, 1.4);

            /* headline and dek */
            tl.fromTo($("headline"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: soft }, 1.8);
            tl.fromTo($("dek"), { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.7, ease: soft }, 2.2);

            /* points sections appear sequentially */
            tl.fromTo($("confirmed"), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.7, ease: soft }, 2.8);
            tl.fromTo($("notconfirmed"), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.7, ease: soft }, 3.4);
            tl.fromTo($("whymatters"), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.7, ease: soft }, 4.0);

            /* redaction bars appear */
            tl.to($("redact1"), { opacity: 0.85, duration: 0.3, ease: "none" }, 4.8);
            tl.to($("redact2"), { opacity: 0.85, duration: 0.3, ease: "none" }, 5.0);
            tl.to($("redact3"), { opacity: 0.85, duration: 0.3, ease: "none" }, 5.2);

            /* stamp slams on - fully opaque for contrast compliance */
            tl.fromTo($("stamp"), { scale: 0.6, opacity: 0, rotateZ: -8 }, 
              { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(2)" }, 5.6);

            /* source appears */
            tl.fromTo($("source"), { opacity: 0 }, { opacity: 1, duration: 0.6, ease: soft }, 6.0);

            /* footer brand */
            tl.fromTo($("footer"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: soft }, 6.4);

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
