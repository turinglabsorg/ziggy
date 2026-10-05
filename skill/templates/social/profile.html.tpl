<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=__W__, height=__W__" />
    <title>__NAME__ — profile mark</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
__FONT_FACES__
      html, body { margin: 0; background: __BG__; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: __BG__; }
      .clip { position: absolute; inset: 0; display: grid; place-items: center; }
      #mark { width: __MARK_SIZE__px; height: __MARK_SIZE__px; display: grid; place-items: center; }
      #mark svg { width: 100%; height: 100%; display: block; }
      #monogram { font-family: "__DISPLAY_FAMILY__", sans-serif; font-weight: 600; font-size: __MONO_SIZE__px; letter-spacing: 0.02em; color: __FG__; line-height: 1; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="profile" data-start="0" data-width="__W__" data-height="__W__" data-duration="1">
      <section id="stage" class="clip" data-start="0" data-duration="1" data-track-index="0">
        <div id="mark">__MARK_INNER__</div>
      </section>
    </div>
    <script>
      var tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: 1, ease: "none" }, 0);
      window.__timelines["profile"] = tl;
    </script>
  </body>
</html>
