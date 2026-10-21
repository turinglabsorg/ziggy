<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <title>__NAME__ — eventi della settimana (__ID__, __W__×__H__)</title>
  </head>
  <body>
    <template>
      <style>
__FONT_FACES__
        #root {
          --bg: __BG__; --fg: __FG__; --muted: __MUTED__; --line: __LINE__; --accent: __ACCENT__;
          --sun: __EV_SUN__; --hot: __EV_HOT__; --lime: __EV_LIME__; --sea: __EV_SEA__; --card: __EV_CARD_BG__; --night2: __EV_NIGHT2__; --days: __EV_DAYS__;
          --display: "__DISPLAY_FAMILY__", sans-serif; --text: "__TEXT_FAMILY__", sans-serif; --mono: "__MONO_FAMILY__", monospace;
          __EV_VARS__
          position: absolute; inset: 0; overflow: hidden; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased;
        }
        #root *, #root *::before, #root *::after { box-sizing: border-box; }
        #__ID__-stage { position: absolute; inset: 0; }

        /* the brand night: two soft pools of the brand's own purples behind everything */
        #__ID__-glow { position: absolute; inset: 0; background:
          radial-gradient(70% 42% at 92% 4%, var(--card) 0%, rgba(__BG_RGB__, 0) 100%),
          radial-gradient(80% 40% at 0% 100%, var(--night2) 0%, rgba(__BG_RGB__, 0) 100%); }

        /* everything readable sits inside the title-safe box: below __EV_* padTop, above the footer */
        #__ID__-content { position: absolute; left: var(--v-pad-x); right: var(--v-pad-x); top: var(--v-pad-top); bottom: calc(var(--v-pad-bottom) + var(--v-foot) * 1.3 + 52px); }

        /* header over the cards: range on the left, card counter on the right */
        #__ID__-head { position: absolute; left: 0; top: 0; margin: 0; display: flex; align-items: center; gap: 16px; font-family: var(--mono); font-weight: 500; font-size: var(--v-head); line-height: 1.6; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); visibility: hidden; }
        #__ID__-head .k-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }

        /* the week, Monday to Sunday: the current card's days light up underneath */
        .ev-strip { display: grid; grid-template-columns: repeat(var(--days, 7), 1fr); gap: 10px; }
        #__ID__-mini { position: absolute; left: 0; right: 0; top: calc(var(--v-head) * 1.6 + 18px); height: var(--v-strip); visibility: hidden; }
        .ev-ms-day { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 1px solid var(--line); border-radius: 14px; }
        .ev-ms-wd { font-family: var(--mono); font-weight: 500; font-size: calc(var(--v-strip) * 0.2); letter-spacing: 0.12em; color: var(--muted); line-height: 1.2; }
        .ev-ms-n { font-family: var(--display); font-weight: 720; font-size: calc(var(--v-strip) * 0.36); line-height: 1.05; color: var(--fg); }
        .ev-ms-dot { position: absolute; left: 18%; right: 18%; bottom: -1px; height: 5px; border-radius: 3px; background: var(--accent); opacity: 0; visibility: hidden; }

        /* one card per event, one visible at a time */
        .ev-card { position: absolute; inset: 0; padding-top: calc(var(--v-head) * 1.6 + 18px + var(--v-strip) + 30px); display: flex; flex-direction: column; visibility: hidden; opacity: 0; }
        .ev-count { position: absolute; right: 0; top: 0; font-family: var(--mono); font-weight: 500; font-size: var(--v-head); line-height: 1.6; letter-spacing: 0.12em; color: var(--fg); }
        .ev-count-of { color: var(--muted); }
        /* the poster takes whatever the text leaves, up to --v-poster-h: a one-line title gets a bigger poster */
        .ev-poster { position: relative; flex: 1 1 auto; min-height: calc(var(--v-poster-h) * 0.6); max-height: var(--v-poster-h); border-radius: 26px; overflow: hidden; background: var(--card); }
        .ev-poster-bg { position: absolute; left: -60px; top: -60px; width: calc(100% + 120px); height: calc(100% + 120px); background-size: cover; background-position: center; filter: blur(38px) brightness(0.5) saturate(1.15); }
        .ev-poster-img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain; padding: 26px; filter: drop-shadow(0 18px 36px rgba(0, 0, 0, 0.5)); }
        .ev-credit { margin: 12px 0 0; min-height: calc(var(--v-credit) * 1.35); font-family: var(--mono); font-weight: 400; font-size: var(--v-credit); line-height: 1.35; letter-spacing: 0.04em; color: var(--muted); }

        /* no poster: a typographic card, the day as the picture */
        .ev-type { display: grid; grid-template-columns: auto 1fr; grid-template-rows: 1fr auto; column-gap: 34px; padding: 44px 48px 40px; background: linear-gradient(160deg, var(--card) 0%, var(--night2) 100%); }
        .ev-type-n { grid-row: 1; grid-column: 1; align-self: center; font-family: var(--display); font-weight: 800; font-size: calc(var(--v-poster-h) * 0.5); line-height: 0.82; letter-spacing: -0.05em; color: var(--accent); }
        .ev-type-m { grid-row: 1; grid-column: 2; align-self: center; display: flex; flex-direction: column; gap: 14px; font-family: var(--display); font-weight: 720; font-size: calc(var(--v-poster-h) * 0.1); line-height: 1; color: var(--fg); }
        .ev-type-wd { font-family: var(--mono); font-weight: 500; font-size: calc(var(--v-poster-h) * 0.044); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
        .ev-type-grid { grid-row: 2; grid-column: 1 / span 2; display: grid; grid-template-columns: repeat(var(--days, 7), 1fr); gap: 10px; }
        .ev-tg-day { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0; border-radius: 12px; border: 1px solid var(--line); }
        .ev-tg-wd { font-family: var(--mono); font-weight: 500; font-size: calc(var(--v-poster-h) * 0.032); color: var(--muted); }
        .ev-tg-n { font-family: var(--display); font-weight: 720; font-size: calc(var(--v-poster-h) * 0.05); line-height: 1; color: var(--fg); }
        .ev-tg-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
        .ev-tg-day.on .ev-tg-dot { background: var(--accent); }

        .ev-credit, .ev-text { flex: 0 0 auto; }
        .ev-text { margin-top: 26px; }
        /* the town first and big: which town is the first thing read on a card */
        .ev-town { margin: 0 0 18px; font-family: var(--display); font-weight: 800; font-size: calc(var(--v-ev-title) * 1.05); line-height: 0.95; letter-spacing: 0.01em; text-transform: uppercase; color: var(--accent); overflow-wrap: break-word; }
        .ev-date { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; font-family: var(--mono); font-weight: 500; font-size: var(--v-ev-date); letter-spacing: 0.1em; text-transform: uppercase; line-height: 1.2; }
        /* tinted, not filled: the text keeps its contrast while the card fades in */
        .ev-when { padding: 8px 16px; border-radius: 10px; background: rgba(__ACCENT_RGB__, 0.16); box-shadow: inset 0 0 0 2px rgba(__ACCENT_RGB__, 0.55); color: var(--accent); }
        .ev-time { color: var(--fg); }
        .ev-title { margin: 20px 0 0; font-family: var(--display); font-weight: 720; line-height: 1.04; letter-spacing: -0.02em; color: var(--fg); overflow-wrap: break-word; text-wrap: balance; }
        .ev-meta { margin: 22px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; }
        /* category: the brand's own colours as an outline chip on the night */
        .ev-chip { padding: 7px 14px; border-radius: 999px; border: 2px solid currentColor; font-family: var(--mono); font-weight: 500; font-size: calc(var(--v-ev-meta) * 0.8); letter-spacing: 0.12em; text-transform: uppercase; line-height: 1.2; }
        .ev-chip.tone-sun { color: var(--sun); } .ev-chip.tone-hot { color: var(--hot); } .ev-chip.tone-lime { color: var(--lime); } .ev-chip.tone-sea { color: var(--sea); }
        .ev-where { font-family: var(--text); font-weight: 400; font-size: var(--v-ev-meta); line-height: 1.3; color: var(--muted); }
        .ev-sep { color: var(--accent); }

        /* intro: the range, the title, the week with a dot on every day that has an event */
        #__ID__-intro { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: 44px; }
        #__ID__-intro-kicker { align-self: flex-start; margin: 0; padding: 12px 20px; border-radius: 12px; background: var(--accent); color: var(--bg); font-family: var(--mono); font-weight: 500; font-size: var(--v-intro-kicker); letter-spacing: 0.14em; line-height: 1.2; }
        #__ID__-intro-title { margin: 0; font-family: var(--display); font-weight: 800; font-size: var(--v-intro-title); line-height: 0.98; letter-spacing: -0.035em; color: var(--fg); text-wrap: balance; }
        #__ID__-intro-title .w { display: inline-block; }
        #__ID__-intro-title .hl { color: var(--accent); }
        #__ID__-strip { height: var(--v-intro-strip); }
        .ev-ws-day { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border-radius: 18px; background: var(--card); }
        .ev-ws-wd { font-family: var(--mono); font-weight: 500; font-size: calc(var(--v-intro-strip) * 0.15); letter-spacing: 0.1em; color: var(--muted); line-height: 1.1; }
        .ev-ws-n { font-family: var(--display); font-weight: 720; font-size: calc(var(--v-intro-strip) * 0.26); line-height: 1; color: var(--fg); }
        .ev-ws-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--line); }
        .ev-ws-day.on .ev-ws-dot { background: var(--accent); }

        /* outro: where the rest of the week lives */
        #__ID__-outro { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; visibility: hidden; }
        /* the last frame is the reel's cover: it says which week this is */
        #__ID__-outro-kicker { margin: 0; padding: 10px 18px; border-radius: 12px; background: rgba(__ACCENT_RGB__, 0.16); box-shadow: inset 0 0 0 2px rgba(__ACCENT_RGB__, 0.55); color: var(--accent); font-family: var(--mono); font-weight: 500; font-size: var(--v-intro-kicker); letter-spacing: 0.14em; line-height: 1.2; }
        #__ID__-outro-title { margin: 22px 0 0; font-family: var(--display); font-weight: 800; font-size: calc(var(--v-cta-lead) * 1.15); line-height: 1.02; letter-spacing: -0.025em; color: var(--fg); text-wrap: balance; }
        #__ID__-outro-title .hl { color: var(--accent); }
        #__ID__-outro-rule { display: block; width: 100%; height: 1px; margin: 56px 0 52px; background: var(--line); }
        #__ID__-outro-mark { width: calc(var(--v-cta-url) * 1.1); height: calc(var(--v-cta-url) * 1.1); margin-bottom: 40px; }
        #__ID__-outro-mark svg { width: 100%; height: 100%; display: block; overflow: visible; }
        #__ID__-cta-lead { margin: 0; font-family: var(--display); font-weight: 720; font-size: var(--v-cta-lead); line-height: 1.1; letter-spacing: -0.015em; color: var(--fg); }
        #__ID__-cta-box { width: 100%; margin-top: 18px; }
        #__ID__-cta-url { display: inline-block; font-family: var(--display); font-weight: 800; font-size: var(--v-cta-url); line-height: 1.05; letter-spacing: -0.03em; color: var(--accent); white-space: nowrap; }
        #__ID__-cta-line { display: block; height: 8px; width: 100%; margin-top: 14px; border-radius: 4px; background: var(--accent); }
        #__ID__-propose { margin: 54px 0 0; max-width: 92%; font-family: var(--text); font-weight: 400; font-size: var(--v-propose); line-height: 1.35; color: var(--muted); }

        /* footer: the brand and the calendar's address, on screen the whole time */
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
            <div id="__ID__-intro">
              <p id="__ID__-intro-kicker">__EV_RANGE__</p>
              <h1 id="__ID__-intro-title">__EV_TITLE_WORDS__</h1>
              <div id="__ID__-strip" class="ev-strip">__EV_STRIP__</div>
            </div>

            <p id="__ID__-head"><span class="k-dot"></span><span>Eventi · __EV_RANGE__</span></p>
            <div id="__ID__-mini" class="ev-strip">__EV_MINI__</div>
__EV_CARDS__

            <div id="__ID__-outro">
              <p id="__ID__-outro-kicker">__EV_RANGE__</p>
              <p id="__ID__-outro-title">__EV_TITLE_WORDS__</p>
              <span id="__ID__-outro-rule"></span>
              <span id="__ID__-outro-mark">__MARK_SVG__</span>
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
          var N = __EV_N__;
          var TI = __EV_T_INTRO__, TC = __EV_T_CARD__;

          /* titles hold three lines at most, the url one line: shrink until they fit */
          function fit() {
            var titles = document.querySelectorAll("#" + ID + "-content .ev-title");
            Array.prototype.forEach.call(titles, function (el) {
              var size = parseFloat(el.getAttribute("data-size") || getComputedStyle(el).fontSize);
              el.setAttribute("data-size", size);
              el.style.fontSize = size + "px";
              while (el.getBoundingClientRect().height > size * 1.04 * 3 + 2 && size > 28) { size -= 2; el.style.fontSize = size + "px"; }
            });
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

            tl.fromTo($("glow"), { opacity: 0 }, { opacity: 1, duration: 1.2, ease: soft }, 0);

            /* footer: the brand from the first second */
            tl.fromTo($("foot"), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: soft }, 0.25);
            tl.fromTo($("foot-line"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.8, ease: "power3.inOut" }, 0.35);

            /* intro: range chip, title word by word, the week with its event days dotted */
            tl.fromTo($("intro-kicker"), { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: hard }, 0.15);
            tl.fromTo(q("#" + ID + "-intro-title .w"), { yPercent: 70, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: hard, stagger: 0.07 }, 0.3);
            tl.fromTo(q("#" + ID + "-strip .ev-ws-day"), { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: soft, stagger: 0.05 }, 0.75);
            tl.fromTo(q("#" + ID + "-strip .ev-ws-day.on .ev-ws-dot"), { scale: 0 }, { scale: 1, duration: 0.4, ease: "back.out(3)", stagger: 0.08 }, 1.25);
            tl.to($("intro"), { autoAlpha: 0, y: -30, duration: 0.35, ease: "power2.in" }, TI - 0.35);

            /* header + week strip over the cards */
            tl.fromTo($("head"), { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: soft }, TI - 0.1);
            tl.fromTo($("mini"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: soft }, TI - 0.05);

            /* the cards */
            for (var i = 0; i < N; i++) {
              var tS = TI + i * TC;
              var card = $("card-" + i);
              if (!card) continue;
              tl.fromTo(card, { autoAlpha: 0, x: 0 }, { autoAlpha: 1, x: 0, duration: 0.25, ease: "none" }, tS);
              tl.fromTo(card.querySelector(".ev-poster"), { y: 46, scale: 0.97 }, { y: 0, scale: 1, duration: 0.55, ease: hard }, tS);
              var img = card.querySelector(".ev-poster-img");
              if (img) tl.fromTo(img, { scale: 1 }, { scale: 1.05, duration: TC, ease: "none" }, tS);
              tl.fromTo(q(".ev-town, .ev-date, .ev-title, .ev-meta", card), { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.36, ease: soft, stagger: 0.05 }, tS + 0.08);
              tl.fromTo(q(".ev-credit, .ev-count", card), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: soft }, tS + 0.2);
              var days = (card.getAttribute("data-days") || "").split(",");
              q("#" + ID + "-mini .ev-ms-day").forEach(function (cell) {
                if (days.indexOf(cell.getAttribute("data-day")) === -1) return;
                var dot = cell.querySelector(".ev-ms-dot");
                tl.fromTo(dot, { autoAlpha: 0, scaleX: 0 }, { autoAlpha: 1, scaleX: 1, duration: 0.3, ease: soft, immediateRender: false }, tS + 0.1);
                tl.to(dot, { autoAlpha: 0, duration: 0.2, ease: "none" }, tS + TC - 0.22);
              });
              tl.to(card, { autoAlpha: 0, x: -40, duration: 0.28, ease: "power2.in" }, tS + TC - 0.28);
            }

            /* outro: the calendar's address, held to the end */
            var tO = TI + N * TC;
            tl.to([$("head"), $("mini")], { autoAlpha: 0, duration: 0.3, ease: "none" }, tO - 0.3);
            tl.fromTo($("outro"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: "none" }, tO);
            tl.fromTo($("outro-kicker"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: soft }, tO);
            tl.fromTo($("outro-title"), { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tO + 0.08);
            tl.fromTo($("outro-rule"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.6, ease: "power3.inOut" }, tO + 0.15);
            tl.fromTo($("outro-mark"), { autoAlpha: 0, scale: 0.6, rotation: -30 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.7, ease: hard }, tO + 0.1);
            tl.fromTo($("cta-lead"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tO + 0.15);
            tl.fromTo($("cta-url"), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: hard }, tO + 0.3);
            tl.fromTo($("cta-line"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.7, ease: "power3.inOut" }, tO + 0.65);
            tl.fromTo($("propose"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: soft }, tO + 0.95);

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
