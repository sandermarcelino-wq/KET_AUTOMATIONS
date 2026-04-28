const { chromium } = require("playwright");
const path = require("path");

async function run() {
  const htmlPath = path.resolve(
    __dirname,
    "../outputs/apartamento_luxo_bairro_x_2026-04-27/ads/ad.html"
  );
  const outputPath = path.resolve(
    __dirname,
    "../outputs/apartamento_luxo_bairro_x_2026-04-27/ads/instagram_ad.png"
  );

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1080, height: 1080 });
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
  await page.waitForLoadState("networkidle");

  await page.screenshot({
    path: outputPath,
    clip: { x: 0, y: 0, width: 1080, height: 1080 },
  });

  await browser.close();
  console.log(`OK — instagram_ad.png saved to ${outputPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
