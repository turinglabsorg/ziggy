<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=__W__, height=__H__" />
    <title>__NAME__ — slide __LAYOUT__</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
__FONT_FACES__
      html, body { margin: 0; background: __BG__; }
      #root {
        position: relative; width: 100%; height: 100%; overflow: hidden;
        background: __BG__; color: __FG__; -webkit-font-smoothing: antialiased;
      }
      .clip { position: absolute; inset: 0; }
      #stars { position: absolute; inset: 0; pointer-events: none; }
      #stars .star { position: absolute; border-radius: 50%; }
      #stars .star.fg { background: __FG__; }
      #stars .star.muted { background: __MUTED__; }
      #photo { position: absolute; left: 0; right: 0; top: 0; height: 760px; overflow: hidden; display: __PHOTO_DISPLAY__;
        -webkit-mask-image: linear-gradient(to bottom, #000 0, #000 72%, transparent 100%);
        mask-image: linear-gradient(to bottom, #000 0, #000 72%, transparent 100%); }
      #photo img { display: block; width: 100%; height: 100%; object-fit: cover; }
      #shade { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(__BG_RGB__, 0.12), rgba(__BG_RGB__, 0) 42%, rgba(__BG_RGB__, 0.55)); }
      #frame { position: absolute; left: 72px; right: 72px; top: __TOP__px; bottom: 88px; display: flex; flex-direction: column; }
      .kicker { margin: 0 0 28px; font-family: "__MONO_FAMILY__", monospace; font-weight: 500; font-size: 22px; letter-spacing: 0.16em; text-transform: uppercase; color: __MUTED__; display: __KICKER_DISPLAY__; align-items: center; gap: 16px; }
      .kicker i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: __ACCENT__; font-style: normal; }
      h1 { margin: 0; font-family: "__DISPLAY_FAMILY__", sans-serif; font-weight: 400; font-size: 64px; line-height: 1.08; letter-spacing: -0.015em; display: __HEADLINE_DISPLAY__; }
      .dek { margin: 0; font-family: "__TEXT_FAMILY__", sans-serif; font-weight: 300; font-size: 40px; line-height: 1.38; color: __FG__; opacity: 0.9; display: __DEK_DISPLAY__; }
      .cta { margin: 0 0 36px; font-family: "__DISPLAY_FAMILY__", sans-serif; font-weight: 400; font-size: 72px; line-height: 1.05; letter-spacing: -0.02em; display: __CTA_DISPLAY__; }
      .meta { margin: 0 0 28px; font-family: "__MONO_FAMILY__", monospace; font-weight: 400; font-size: 22px; letter-spacing: 0.14em; text-transform: uppercase; color: __MUTED__; display: __META_DISPLAY__; }
      footer { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; border-top: 1px solid __LINE__; padding-top: 28px; }
      .brand { position: relative; font-family: "__DISPLAY_FAMILY__", sans-serif; font-size: 36px; line-height: 1; letter-spacing: __LETTER_SPACING__; text-transform: __TEXT_TRANSFORM__; white-space: nowrap; padding-right: 0.55em; }
      .brand .part + .part { margin-left: 0.32em; }
      .brand .dot { position: absolute; top: 0.02em; right: 0; width: 0.16em; height: 0.16em; border-radius: 50%; background: __ACCENT__; }
      .url { font-family: "__MONO_FAMILY__", monospace; font-weight: 500; font-size: 22px; letter-spacing: 0.16em; text-transform: uppercase; text-align: right; }
      .url b { display: block; height: 2px; width: 100%; margin-top: 10px; background: __ACCENT__; font-weight: 400; }
      .layout-text #photo { display: none; }
      .layout-close #photo { display: none; }
      .layout-close #frame { top: 280px; }
    </style>
  </head>
  <body>
    <div id="root" class="layout-__LAYOUT__" data-composition-id="slide" data-start="0" data-width="__W__" data-height="__H__" data-duration="1">
      <section id="stage" class="clip" data-start="0" data-duration="1" data-track-index="0">
        <div id="stars">__STARS__</div>
        <div id="photo" data-layout-allow-overflow="true"><img src="__IMAGE_SRC__" alt="" /><div id="shade"></div></div>
        <div id="frame">
          <p class="kicker"><i></i>__KICKER__</p>
          <h1>__HEADLINE__</h1>
          <p class="dek">__DEK__</p>
          <p class="cta">__CTA__</p>
          <p class="meta">__META__</p>
          <footer>
            <span class="brand">__BRAND____DOT__</span>
            <span class="url">__URL__<b></b></span>
          </footer>
        </div>
      </section>
    </div>
    <script>
      var tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: 1, ease: "none" }, 0);
      window.__timelines["slide"] = tl;
    </script>
  </body>
</html>
