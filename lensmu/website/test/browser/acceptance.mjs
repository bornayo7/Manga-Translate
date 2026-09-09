// Production website and real browser controls. HTTP fixtures make error and
// mixed-outcome cases reproducible. Optional live OCR uses an explicit fixture.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_PACKAGE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_PACKAGE)).href : 'playwright');
const base=process.env.WEBSITE_URL || 'http://127.0.0.1:3001';
const artifacts=process.env.BROWSER_ARTIFACTS || await mkdtemp(join(tmpdir(),'lensmu-website-browser-'));
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const page=await context.newPage();
const pageErrors=[];page.on('pageerror',(error)=>pageErrors.push(error.message));
const results=[];
try {
  // Build an original, non-sensitive test image locally, without a dependency.
  const fixturePage=await context.newPage();
  await fixturePage.setContent('<div style="width:600px;height:300px;background:white;color:black;font:36px sans-serif;padding:30px">こんにちは<br><br>世界</div>');
  const fixture=await fixturePage.locator('div').screenshot();await fixturePage.close();
  for(const width of [320,390,820,1280]) {
    await page.setViewportSize({width,height:900});
    for(const route of ['/','/translate','/install','/about','/contact']) {
      await page.goto(base+route,{waitUntil:'networkidle'});
      assert.equal(await page.locator('h1').count(),1,`${route}: one page heading`);
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,missingAlt:[...document.images].filter(image=>!image.hasAttribute('alt')).length}));
      assert.ok(layout.scroll<=width,`${route} overflows at ${width}px`);assert.equal(layout.missingAlt,0);
      results.push({route,width,overflow:false});
      if(route==='/' && [390,1280].includes(width)) await page.screenshot({path:join(artifacts,`home-${width}.png`),fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844});await page.goto(base);
  assert.equal(await page.locator('#mobile-menu').count(),0);
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Install',exact:true}).focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#mobile-menu').count(),0);
  assert.ok(await page.getByRole('button',{name:'Menu',exact:true}).evaluate(element=>element===document.activeElement));
  await page.getByRole('button',{name:'English',exact:true}).click();
  assert.match(await page.locator('.sample-sheet img').getAttribute('src'),/translated/);
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('button',{name:'Use dark theme',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('class'),'dark');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.screenshot({path:join(artifacts,'home-dark-390.png'),fullPage:true});
  await page.goto(base+'/contact');await page.getByRole('button',{name:'Open email draft'}).click();
  assert.equal(await page.locator('#name').getAttribute('aria-describedby'),'name-error');
  assert.ok(await page.locator('#name').evaluate(element=>element===document.activeElement));
  results.push({navigation:'mobile menu, Escape focus, sample toggle, dark theme and contact error association passed'});

  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/translate');
  await page.getByRole('button',{name:'Use light theme',exact:true}).click();
  await page.locator('#image-file').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:fixture});
  await page.getByText('Local OCR server address',{exact:true}).click();
  await page.locator('#backend-address').fill('http://127.0.0.1:8001');
  let mode='normal';let release;
  const blocks=[{text:'こんにちは',confidence:.99,bbox:[30,20,300,100]},{text:'世界',confidence:.99,bbox:[30,160,300,240]}];
  await page.route('**/ocr/paddle',async route=>{
    if(mode==='hold') await new Promise(resolve=>{release=resolve;});
    await route.fulfill({status:200,contentType:'application/json',body:mode==='malformed'?'{broken':JSON.stringify({detections:mode==='tiny' ? blocks.map(block=>({...block,bbox:[1,1,5,5]})) : blocks})}).catch(()=>{});
  });
  await page.route('https://api.mymemory.translated.net/**',route=>{
    const text=new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({json:{responseStatus:200,responseData:{translatedText:text==='こんにちは'?'Hello':'世界'}}});
  });
  const translate=()=>page.getByRole('button',{name:'Translate image',exact:true}).click();
  mode='hold';await translate();await page.getByText('Your local backend is reading text regions',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel translation',exact:true}).click();
  release?.();assert.equal(await page.getByRole('link',{name:'Download translated PNG'}).count(),0);
  mode='normal';await translate();await page.getByRole('heading',{name:'Partially translated',exact:true}).waitFor();
  assert.match(await page.locator('.transcript').innerText(),/No usable translation returned/);
  assert.match(await page.locator('.result-summary').innerText(),/1 of 2 regions/);
  await page.locator('#target-lang').selectOption('fr');
  assert.equal(await page.locator('.transcript li').first().locator('p').nth(1).getAttribute('lang'),'en');
  assert.match(await page.locator('.result-summary').innerText(),/Japanese → English/);
  await page.locator('#target-lang').selectOption('en');
  mode='tiny';await translate();await page.getByRole('heading',{name:'Translation did not complete'}).waitFor();
  assert.match(await page.locator('.error-note').innerText(),/No translated regions/);
  assert.equal(await page.getByRole('link',{name:'Download translated PNG'}).count(),0);
  mode='malformed';await translate();await page.getByRole('heading',{name:'Translation did not complete'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Download translated PNG'}).count(),0);
  results.push({fixturePipeline:'cancel/retry, mixed source echo, immutable result languages, all unfit and malformed OCR passed'});

  if(process.env.LIVE_OCR_URL && process.env.LIVE_IMAGE) {
    await page.unroute('**/ocr/paddle');await page.unroute('https://api.mymemory.translated.net/**');
    await page.locator('#image-file').setInputFiles(resolve(process.env.LIVE_IMAGE));
    await page.locator('#backend-address').fill(process.env.LIVE_OCR_URL);await translate();
    await page.getByRole('heading',{name:/Translation ready|Partially translated|Translation did not complete/}).waitFor({timeout:100000});
    assert.equal(await page.getByRole('link',{name:'Download translated PNG'}).count(),1,await page.locator('.demo-controls').innerText());
    await page.screenshot({path:join(artifacts,'live-ocr-result.png'),fullPage:true});
    const pendingDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download translated PNG'}).click();
    await (await pendingDownload).saveAs(join(artifacts,'real-translated.png'));
    results.push({livePipeline:await page.locator('.result-summary').innerText(),transcript:await page.locator('.transcript').innerText()});
  }
  assert.deepEqual(pageErrors,[]);
  await writeFile(join(artifacts,'results.json'),JSON.stringify({results,pageErrors},null,2));
  console.log(JSON.stringify({passed:true,cases:results.length,artifacts,pageErrors},null,2));
} catch(error) {
  await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true});
  console.error(error);console.error('Artifacts:',artifacts);process.exitCode=1;
} finally {await browser.close();}
