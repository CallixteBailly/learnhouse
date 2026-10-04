export async function register() {
  // Sans DSN configurée, Sentry.init est un no-op : ne pas importer du tout
  // les configs évite de charger la chaîne OTel (lourde, et son
  // require-in-the-middle casse le serveur standalone Turbopack — alias
  // externes hachés introuvables au runtime).
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (
  error: Error & { digest?: string },
  request: Request,
  context: { routerKind: string; routePath: string; routeType: string; revalidateReason?: string }
) => {
  // Sentry is already initialized via sentry.server.config — just capture if active
  const Sentry = await import("@sentry/nextjs");
  if (Sentry.isInitialized()) {
    Sentry.captureException(error, {
      extra: {
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        revalidateReason: context.revalidateReason,
      },
    });
  }
};
