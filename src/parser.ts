import { ParsedOpenApi } from './types';
import { OpenAPIV3 } from 'openapi-types';
import { ElementHandle, Page } from 'puppeteer';

async function parsePaths(
  div: ElementHandle<HTMLDivElement>,
  paths: OpenAPIV3.PathsObject = {}
): Promise<OpenAPIV3.PathsObject> {
  const tagName = await textContent(await div.$('h1[id^="tag-"]'));
  console.log('Parsing paths for ' + tagName);
  if (!tagName) return {};
  const operations = await div.$$('div[id^="operation-"]');
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
 * @param page The Puppeteer page of the API documentation.
 * @returns The ParsedOpenApi object.
 */
export async function parsePageToOpenAPI(page: Page): Promise<ParsedOpenApi> {
  const endpoints = await page.$$('div#docs article div.ns-support-ga');

  const paths: OpenAPIV3.PathsObject = {};

  for (const endpoint of endpoints) {
    const endpointPaths = await parsePaths(endpoint);
    Object.assign(paths, endpointPaths);
  }

  const schemaElements = await page.$$('div[id^="definition-"]');

  const schemaElement = schemaElements[0];

  const schemas: OpenAPIV3.ComponentsObject['schemas'] = {};

  // for(const schemaElement of schemaElements) {
  //   await parseSchemas(schemaElement, schemas);
  // }

  await parseSchemas(schemaElement, schemas);

  return {
    components: {
      schemas,
    },
    paths,
  };
}

async function parseSchemas(schemaElement: ElementHandle<HTMLDivElement>, schemas: Exclude<OpenAPIV3.ComponentsObject['schemas'], undefined>) {
  const title = await textContent(await schemaElement.$('h2'));
  const schema: OpenAPIV3.SchemaObject = {
    type: 'object',
    properties: await parseSchemaProperties(schemaElement)
  }
  schemas[title] = schema;
}

async function parseSchemaProperties(schemaElement: ElementHandle<HTMLDivElement>): Promise<OpenAPIV3.BaseSchemaObject['properties']> {
  const properties = await schemaElement.$$('section.json-schema-properties dl dt');
  const result: OpenAPIV3.BaseSchemaObject['properties'] = {};

  result['id'] = {
    type: 'object',
    $ref: '#/components/schemas/RecordRef'
  }

  for (let i = 0; i < properties.length; i++) {
    const property = properties[i];

    /* There is multiple cases to handle here
    - if it's a boolean, or string, or number, we will only parse the current property object
      example :
      "acctNumber": {
          "title": "Number",
          "type": "string",
          "description": "Enter the number to identify this account. The number can be alphanumeric. The maximum number of characters is 60.",
          "nullable": true
      },
    - if it's a reference to another resource, we have to parse the reference only
      example :
      "accountContextSearch": {
          "$ref": "#/components/schemas/account-accountContextSearchCollection"
      },
    - if it's an object type, we have to parse the current property object and the next one (which will include the schema of the object)
      example :
      "cashFlowRate": {
          "type": "object",
          "properties": {
              "id": {
                  "title": "Internal identifier",
                  "type": "string",
                  "enum": [
                      "AVERAGE",
                      "HISTORICAL",
                      "CURRENT"
                  ]
              },
              "refName": {
                  "title": "Reference Name",
                  "type": "string"
              }
          }
      },
      - if it's an array type, we have to parse the current property object and the next one (which will include the schema of the array)
      example :
      "links": {
          "title": "Links",
          "type": "array",
          "readOnly": true,
          "items": {
              "$ref": "#/components/schemas/nsLink"
          }
      },
      - if there is a description, we have to parse the current property object and the next one (which will include the description)
      example : 
      "isSummary": {
          "title": "Summary",
          "type": "boolean",
          "description": "Check this box to make this account record solely for reporting purposes. Summary accounts are useful when you want to create a non-posting, inactive parent account that has active child accounts. If you do not have a OneWorld account, new summary accounts cannot have an opening balance, but you can convert an existing account with a transaction balance into a summary account. In this case, you cannot post additional transactions to the account. Summary accounts appear with their children in the chart of accounts list. You cannot merge a summary account into another account."
      },
    */

    let type: Exclude<OpenAPIV3.SchemaObject['type'], undefined>;
    const hasInnerSchema = i < properties.length - 1 && await properties[i+1].evaluate((el) => el.className === 'json-inner-schema');
    if (hasInnerSchema) {
      const innerSchema = properties[i+1];
      i++;

      const sectionClassName = await innerSchema.evaluate(el => el.className);

      if (sectionClassName.includes('json-schema-array-items')) {
        type = 'array';
      } else if (sectionClassName.includes('json-schema-properties')) {
        type = 'object';
      } else {
        type = 'string'
      }
    } else {
      type = await textContent(await property.$('.json-property-type')) as OpenAPIV3.NonArraySchemaObjectType;
    }

    const name = await textContent(await property.$('.json-property-name'));

    const description = await textContent(await property.$('.prop-value p'));
    const required = !!(await property.$('.json-property-required'));
    const schema: OpenAPIV3.SchemaObject = {
      type: 'string',
      description,




    }
    result[name] = {
      description,
      schema
    }
  }

  return result;

}

async function parseArraySchema(property: ElementHandle<HTMLElement>, innerSchema: ElementHandle<HTMLElement>) {
  const name = await textContent(await property.$('.json-property-name'));
  const title = await textContent(await property.$('.json-property-title'));
  const type = 'array';
  const readOnly = !!(await property.$('.json-property-read-only'));
  const schema: OpenAPIV3.ArraySchemaObject = {
    type,
    title,
    readOnly,
    items: (await parseNonArraySchema(innerSchema)).schema
  }
  return {
    name,
    schema
  }
}

async function parseNonArraySchema(property: ElementHandle<HTMLElement>): Promise<{name: string, schema: OpenAPIV3.NonArraySchemaObject}> {
  const name = await textContent(await property.$('.json-property-name'));
  const title = await textContent(await property.$('.json-property-title'));
  const type = await textContent(await property.$('.json-property-type')) as OpenAPIV3.NonArraySchemaObjectType;
  const readOnly = !!(await property.$('.json-property-read-only'));
  const formatElement = await property.$('.json-property-format');
  const format = (formatElement && (await textContent(formatElement)).replaceAll('(', '').replaceAll(')', '').trim()) || undefined;
  const schema: OpenAPIV3.NonArraySchemaObject = {
    type,
    title,
    readOnly,
    format
  }
  return {
    name,
    schema
  }
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
