      if (!success) {
        console.error(`❌ ${platform.name} failed all selectors`);

        // Enhanced diagnostics
        try {
          const pageTitle = await page.title().catch(() => 'Could not get title');
          const bodySnippet = await page.evaluate(() => 
            document.body?.innerHTML?.slice(0, 600) ?? 'empty'
          ).catch(() => 'Could not get body');

          console.error(`[${platform.name}] Page Title: ${pageTitle}`);
          console.error(`[${platform.name}] Body Snippet: ${bodySnippet.substring(0, 400)}...`);
        } catch (diagError) {
          console.warn(`Diagnostics failed for ${platform.name}`);
        }

        // Safe screenshot
        try {
          await page.screenshot({ 
            path: `test-results/${platform.name.toLowerCase()}-failure.png`, 
            fullPage: true 
          });
        } catch (screenshotError) {
          console.warn(`⚠️ Screenshot failed for ${platform.name}: ${screenshotError.message}`);
        }

        throw new Error(`${platform.name} check failed`);
      }
