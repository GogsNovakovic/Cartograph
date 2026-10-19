export {};

declare global {
  // Added in the Clerk dashboard under Sessions → Customize session token:
  //   { "org_name": "{{org.name}}" }
  interface CustomJwtSessionClaims {
    org_name?: string;
  }
}
