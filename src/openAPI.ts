import {  ParsedOpenApi } from './types';
import {  OpenAPIV3 } from "openapi-types";


export function generateOpenAPISchema(parsed : ParsedOpenApi ) {
  const schema: OpenAPIV3.Document = {
    openapi: '3.0.0',
    info: {
      title: 'NetSuite REST API',
      version: '1.0.0',
      description: 'Generated OpenAPI schema for NetSuite REST API.',
    },
    paths: parsed.paths,
    components: parsed.components
  };

  return schema;
}
