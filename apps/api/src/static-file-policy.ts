import type { FastifyStaticOptions } from "@fastify/static";

type AdditionalPathPolicy = NonNullable<FastifyStaticOptions["allowedPath"]>;

export const isAllowedUploadPath = (pathname: string) => !pathname.includes("\\") && !pathname.includes("\0");

export const createUploadStaticOptions = (
  root: string,
  additionalPathPolicy?: AdditionalPathPolicy,
): FastifyStaticOptions => ({
  root,
  prefix: "/uploads/",
  allowedPath: (pathname, rootPath, request) =>
    isAllowedUploadPath(pathname) && (additionalPathPolicy?.(pathname, rootPath, request) ?? true),
});
