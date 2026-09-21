import {test,expect} from '@playwright/test';
for(const width of [1440,375,390,430])test(`full collection workflow at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.fill('#sourceUrl','https://example.com/public-collection');await page.click('#scanButton');
 await expect(page.locator('#pauseButton')).toBeVisible();await page.click('#pauseButton');await expect(page.locator('#resumeButton')).toBeVisible();
 await page.reload();await expect(page.locator('#resumeButton')).toBeVisible();await page.click('#resumeButton');
 await expect(page.locator('#statusTitle')).toContainText('Complete',{timeout:30000});await expect(page.locator('#statVideos')).toHaveText('60');await expect(page.locator('.video-card')).toHaveCount(24);
 expect(Number((await page.locator('#statViews').textContent())!.replaceAll(',',''))).toBeGreaterThan(2_000_000_000);
 await expect(page.locator('.card-title').first()).toHaveText('Synthetic lesson 59');
 await page.click('#nextResults');await expect(page.locator('.card-title').first()).toHaveText('Synthetic lesson 35');
 await page.selectOption('#sort','views_asc');await expect(page.locator('.card-title').first()).toHaveText('Synthetic lesson 1');
 await page.selectOption('#sort','published_desc');await expect(page.locator('.card-title').first()).toHaveText('Synthetic lesson 27');
 await page.selectOption('#sort','published_asc');await expect(page.locator('.card-title').first()).toHaveText('Synthetic lesson 0');
 await page.click('#advancedFilters summary');await page.fill('#minViews','1000');await page.fill('#maxViews','2000');await expect(page.locator('#collectionTitle')).toHaveText('11 matching videos');
 await page.click('#resetFilters');await page.fill('#query','Synthetic lesson 59');await expect(page.locator('.video-card')).toHaveCount(1);
 await page.click('[data-detail]');await expect(page.locator('#detailDialog')).toBeVisible();await expect(page.locator('#detailContent')).toContainText('Download unavailable');await page.click('[data-close="detailDialog"]');
 await page.click('[data-save]');await expect(page.locator('#savedCount')).toHaveText('1');await page.click(width<760?'#mobileSaved':'#navSaved');await expect(page.locator('.video-card')).toHaveCount(1);
 await page.click(width<760?'#mobileExplore':'#navExplore');await page.click('#resetFilters');await page.selectOption('#pageSize','48');await expect(page.locator('.video-card')).toHaveCount(48);
 await page.click('#themeButton');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await expect(page.locator('#statVideos')).toHaveText('60');await expect(page.locator('.download-action')).toHaveCount(0);
 const download=page.waitForEvent('download');await page.click('#tableButton');expect((await download).suggestedFilename()).toBe('videoscope-table.csv');
 await page.click('#providersButton');await expect(page.locator('#providersDialog')).toContainText('YOUTUBE_API_KEY');await page.click('[data-close="providersDialog"]');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`artifacts/v4-${width}-viewport.png`});
 await page.screenshot({path:`artifacts/v4-${width}.png`,fullPage:true});
});
test('YouTube configuration failure never becomes a completed zero collection',async({page})=>{
 await page.goto('/');await page.fill('#sourceUrl','https://www.youtube.com/@FilmiIndian/videos');await page.click('#scanButton');await expect(page.locator('#statusTitle')).toContainText('YOUTUBE_API_KEY',{timeout:20000});await expect(page.locator('#emptyTitle')).toHaveText('Source needs attention');
});
