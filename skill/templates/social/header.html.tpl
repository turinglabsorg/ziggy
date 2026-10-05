<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=__W__, height=__H__" />
    <title>__NAME__ — header</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
__FONT_FACES__
      html, body { margin: 0; background: __BG__; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: __BG__; color: __FG__; -webkit-font-smoothing: antialiased; }
      .clip { position: absolute; inset: 0; }
      #stars { position: absolute; inset: 0; pointer-events: none; }
      #stars .star { position: absolute; border-radius: 50%; }
      #stars .star.fg { background: __FG__; }
      #stars .star.muted { background: __MUTED__; }
      #stage-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding-bottom: __LIFT__px; }
      #wordmark { position: relative; white-space: nowrap; font-family: "__DISPLAY_FAMILY__", sans-serif; font-size: __MARK__px; line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; display: inline-block; }
      #wordmark .part { display: inline-block; }
      #wordmark .part + .part { margin-left: 0.32em; }
      #wordmark .dot { position: absolute; top: 0.02em; right: -0.42em; width: 0.15em; height: 0.15em; border-radius: 50%; background: __ACCENT__; }
      #rule { width: __RULE_W__px; height: 2px; background: __LINE__; margin: __RULE_MT__px 0 __RULE_MB__px; }
      #tagline { margin: 0; max-width: __TAG_MAX__px; font-family: "__TEXT_FAMILY__", sans-serif; font-weight: 300; font-size: __TAG__px; line-height: 1.4; letter-spacing: 0.005em; color: __FG__; opacity: 0.86; text-align: center; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="header" data-start="0" data-width="__W__" data-height="__H__" data-duration="1">
      <section id="stage" class="clip" data-start="0" data-duration="1" data-track-index="0">
        <div id="stars">__STARS__</div>
        <div id="stage-content">
          <div id="wordmark">__PARTS____DOT__</div>
          <div id="rule"></div>
          <p id="tagline">__TAGLINE__</p>
        </div>
      </section>
    </div>
    <script>
      var tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: 1, ease: "none" }, 0);
      window.__timelines["header"] = tl;
    </script>
  </body>
</html>
