import puppeteer from 'puppeteer';
import { parsePageToOpenAPI } from './parser';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateOpenAPISchema } from './openAPI';


async function main() {

    const browser = await puppeteer.launch({headless: false});
    const page = (await browser.pages()).at(0);
    if (!page) throw new Error('No page found');
    await page.goto('https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.2/index.html');

    await page.waitForNetworkIdle();

    const parsed = await parsePageToOpenAPI(page);

    const openAPISchema = generateOpenAPISchema(parsed);

    writeFileSync(
      path.resolve(__dirname, '../openapi-schema.json'),
      JSON.stringify(openAPISchema, null, 2)
    );

    await browser.close();
}

main().then();