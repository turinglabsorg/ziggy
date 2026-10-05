<!doctype html>
<html lang="__LANG__">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=__W__, height=__H__" />
    <title>__NAME__ — story</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html, body { margin: 0; background: __BG__; }
      #host { position: relative; width: 100%; height: 100%; overflow: hidden; background: __BG__; }
    </style>
  </head>
  <body>
    <div id="host" data-composition-id="__HOST_ID__" data-start="0" data-width="__W__" data-height="__H__" data-duration="__DUR__">
      <div
        id="scene-story"
        data-composition-id="__ID__"
        data-composition-src="compositions/__ID__.html"
        data-start="0"
        data-duration="__DUR__"
        data-track-index="0"
        data-width="__W__"
        data-height="__H__"
      ></div>
    </div>
    <script>
      var tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: __DUR__, ease: "none" }, 0);
      window.__timelines["__HOST_ID__"] = tl;
    </script>
  </body>
</html>
