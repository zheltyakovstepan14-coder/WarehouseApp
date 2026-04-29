/* eslint-disable no-console */
const { spawnSync } = require('node:child_process');

const maxAttempts = Number(process.env.PW_INSTALL_RETRIES || 5);
const delayMs = Number(process.env.PW_INSTALL_DELAY_MS || 4000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[pw-install] attempt ${attempt}/${maxAttempts}`);
    const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
      stdio: 'inherit',
      shell: true
    });

    if (result.status === 0) {
      console.log('[pw-install] chromium installed');
      return;
    }

    if (attempt < maxAttempts) {
      console.log(`[pw-install] failed, retry in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }

  console.error('[pw-install] all attempts failed');
  process.exit(1);
}

run().catch((error) => {
  console.error('[pw-install] unexpected error:', error.message);
  process.exit(1);
});
