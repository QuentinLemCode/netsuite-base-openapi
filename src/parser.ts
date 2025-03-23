import { ParsedOpenApi } from './types';
import { OpenAPIV3 } from 'openapi-types';
import { ElementHandle, Page } from 'puppeteer';

async function parsePaths(
  div: ElementHandle<HTMLDivElement>
): Promise<OpenAPIV3.PathsObject> {
  const tagName = await textContent(await div.$('h1[id^="tag-"]'));
  if (!tagName) return {};
  const operations = await div.$$('div[id^="operation-"]');
  const paths: OpenAPIV3.PathsObject = {};
  for (const operation of operations) {
    const { path, data, method } = await parseOperation(operation, tagName);
    (paths[path] ||= {})[method] = data;
  }

  return paths;
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function extractMethod(method: string): OpenAPIV3.HttpMethods {
  const extracted =
    OpenAPIV3.HttpMethods[
      method.toUpperCase() as keyof typeof OpenAPIV3.HttpMethods
    ];
  if (!extracted) throw new Error('Invalid method: ' + method);
  return extracted;
}

async function parseOperation(
  operation: ElementHandle<HTMLDivElement>,
  tagName: string
): Promise<{
  path: string;
  method: OpenAPIV3.HttpMethods;
  data: OpenAPIV3.OperationObject;
}> {
  const method = extractMethod(
    await textContent(await operation.$('.operation-method'))
  );
  const path = await textContent(await operation.$('.operation-path'));
  const summary = await textContent(await operation.$('.operation-summary'));
  const parameters = await extractParameters(operation);
  const requestSchema = await extractSchema(operation, 'swagger-request-body');
  const responseSchema = await extractSchema(operation, 'swagger-responses');
  const errorSchema = await extractErrorSchema(operation);
  const responses: OpenAPIV3.ResponsesObject = {
    ...(responseSchema
      ? {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: responseSchema,
              },
            },
          },
        }
      : null),
    ...(errorSchema
      ? {
          default: {
            description: 'Error response',
            content: {
              'application/json': {
                schema: errorSchema,
              },
            },
          },
        }
      : null),
  };
  return {
    path,
    method,
    data: {
      responses,
      summary,
      parameters,
      requestBody: requestSchema
        ? { content: { 'application/json': { schema: requestSchema } } }
        : undefined,
      tags: [capitalize(tagName)],
    },
  };
}

async function extractParameters(
  operation: ElementHandle<HTMLDivElement>
): Promise<OpenAPIV3.ParameterObject[]> {
  const parameters = await operation.$$('.swagger-request-params .prop-row');

  return await Promise.all(
    parameters.map(async (parameter) => {
      const nameEl = await parameter.$('.prop-name .prop-title');
      const name = await nameEl?.evaluate((c) => {
        return Array.from(c.childNodes)
          .filter((c) => c.nodeType === 3) // we only take text nodes and filter out child nodes
          .map((c) => c.textContent)
          .join('')
          .trim()
          .replaceAll(':', '');
      });
      if (!name) throw new Error('Name not found');
      const description = await textContent(await parameter.$('.prop-value p'));
      const required = !!(await parameter.$('.json-property-required'));
      const type = await textContent(
        await parameter.$('.prop-type .json-property-type')
      );

      let schema: OpenAPIV3.SchemaObject;

      if (type === 'array') {
        schema = {
          type: 'array',
          items: {},
        };
      } else {
        schema = {
          type: type as OpenAPIV3.NonArraySchemaObjectType,
        };
      }

      const enumsElement = await parameter.$$('.json-property-enum-item');
      if (enumsElement.length) {
        schema.enum = await Promise.all(
          enumsElement.map(async (el) => {
            return await textContent(el);
          })
        );
      }

      const formatEl = await parameter.$('.prop-format');
      if (formatEl) {
        schema.format = await textContent(formatEl);
      }

      const defaultEl = await parameter.$('.json-property-default-value');
      if (defaultEl) {
        schema.default = await textContent(defaultEl);
      }

      const parameterIn = (
        await textContent(await parameter.$('.prop-subtitle'))
      )
        .replace('in', '')
        .trim();
      const schemaRef = await parameter.$('.json-schema-ref');
      const result: OpenAPIV3.ParameterObject = {
        name,
        description,
        required,
        in: parameterIn,
        schema,
      };

      return result;
    })
  );
}

async function extractSchema(
  operation: ElementHandle<HTMLDivElement>,
  selector: string
): Promise<OpenAPIV3.ReferenceObject | null> {
  const schemaRef = await operation.$(`.${selector} .json-schema-ref`);
  if (!schemaRef) return null;
  const result = await schemaRef.evaluate((el) => el.getAttribute('href'));
  if (!result) return null;
  return { $ref: result };
}

async function extractErrorSchema(
  operation: ElementHandle<HTMLDivElement>
): Promise<OpenAPIV3.ReferenceObject | null> {
  const errorSchemaRef = await operation.$(
    '.swagger-responses .json-schema-ref'
  );
  if (!errorSchemaRef) return null;
  const result = await errorSchemaRef.evaluate((el) => el.getAttribute('href'));
  if (!result) return null;
  return { $ref: result };
}

async function textContent(el: ElementHandle | null) {
  if (!el) throw new Error('Element not found');
  const result = await el.evaluate((el) => el.textContent?.trim());
  if (!result)
    throw new Error('Text content not found for element ' + el.toString());
  return result;
}

/**
 * Parses the NetSuite REST API documentation HTML and extracts API details.
 * @param html The HTML content of the API documentation.
 * @returns An array of parsed API endpoints.
 */
export async function parsePageToOpenAPI(page: Page): Promise<ParsedOpenApi> {
  const endpoints = await page.$$('div#docs article div.ns-support-ga');

  const endpoint = endpoints[0];

  const paths = await parsePaths(endpoint);

  return {
    components: {},
    paths,
  };
}

/**
 * Parses schema definitions from the NetSuite API documentation.
 * @param html The HTML content of the API documentation.
 * @returns A map of schema names to their definitions.
 */
// export function parseSchemas(
//   $: cheerio.CheerioAPI
// ): Record<string, OpenAPIV3.SchemaObject> {
//   const schemas: Record<string, OpenAPIV3.SchemaObject> = {};

//   // Find the section with <h1>Schema Definitions</h1>
//   const schemaSection = $('h1:contains("Schema Definitions")');

//   if (!schemaSection.length) {
//     console.warn('No schema definitions found.');
//     return schemas;
//   }

//   // Iterate through all schema definitions under this section
//   schemaSection.nextUntil('h1').each((_, el) => {
//     const schemaName = $(el).find('h2').text().trim();
//     if (!schemaName) return;

//     const properties: OpenAPIV3.SchemaObject['properties'] = {};
//     // Extract field definitions
//     $(el)
//       .find('dt')
//       .each((_, fieldEl) => {
//         const name = $(fieldEl).find('json-property-name').text().trim();
//         const title = $(fieldEl).find('json-property-title').text().trim();
//         let type: string;
//         let ref: string = '';
//         if ($(fieldEl).find('a').length) {
//           type = 'array';
//           ref = $(fieldEl).find('a.json-schema.ref').attr('href') as string;
//         } else {
//           type = $(fieldEl).find('json-property-type').text().trim();
//         }
//         const format = $(fieldEl).find('json-property-format').text().trim();
//         const range = $(fieldEl).find('json-property-range').text().trim();
//         const readOnly = $(fieldEl).find('json-property-read-only').length > 0;

//         if (name && type) {
//           if (isArrayType(type)) {
//             properties[name] = {
//               type: type,
//               items: {
//                 $ref: ref,
//               },
//             };
//           }
//           if (isNonArrayType(type)) {
//             properties[name] = {
//               type: type,
//               title,
//               format,
//               readOnly,
//             };
//           }
//         }
//       });

//     const schema: OpenAPIV3.SchemaObject = { type: 'object', properties };
//     schemas[schemaName] = schema;
//   });

//   return schemas;
// }

const isArrayType = (type: string): type is OpenAPIV3.ArraySchemaObjectType =>
  type === 'array';
const isNonArrayType = (
  type: string
): type is OpenAPIV3.NonArraySchemaObjectType => !isArrayType(type);
