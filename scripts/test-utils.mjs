// Playwright waitForFunction treats a returned Promise as truthy before its
// boolean value resolves. Poll IPC state from Node instead of using async predicates.
export async function waitForState(page, predicate, description, timeout = 6000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.deck.state());
    if (await predicate(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}; foreground=${last?.foreground}, profile=${last?.applicationProfile}, volume=${last?.system?.volume}`);
}
