export const dashboard = `<main id="dashboard" style="width:640px; height:420px; position:relative; background:#182c41; color:#f5fafc;font:16px system-ui">
  <aside id="side" style="position:absolute;left:24px;top:34px;width:150px;height:340px;background:#275c76;border-radius:12px;padding:18px;box-sizing:border-box">Overview</aside>
  <article id="card" data-velora-anchor="revenue" style="position:absolute;left:203px;top:82px;width:260px;height:155px; background:#277abb;border-radius:18px; box-shadow:0 3px 8px #0003; transform:rotate(0deg) !important">
    <span style="position:absolute;left:50%;top:50%;width:0;height:0" id="card-center"></span>
    <h2 style="margin:15px">Revenue</h2><button id="chart" style="position:absolute;top:62px;left:22px;width:100px;height:40px;border-radius:8px;border:0;background:#ffe17c">Chart</button>
  </article>
  <section id="modal" role="dialog" aria-label="Share" style="position:absolute;left:410px;top:170px;width:170px;height:94px;border-radius:14px;background:#e6edff;color:#10233e;padding:10px;box-sizing:border-box">Share report</section>
  <div id="blocker" style="overflow:hidden;position:absolute;left:215px;top:290px;width:180px;height:64px"><button id="clipped" style="margin:8px;border-radius:6px">Clipped control</button></div>
</main>`;
