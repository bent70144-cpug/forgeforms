import { NextResponse } from "next/server";
import { AppError, errorBody } from "@formforge/core/identity";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session — current session introspection for the app shell.
 * Unauthenticated requests answer with the spec §4 error body (403).
 */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      errorBody(new AppError("FORBIDDEN", "Authentication required.")),
      { status: 403 },
    );
  }

  return NextResponse.json({
    data: {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      workspace: session.workspace
        ? {
            id: session.workspace.id,
            name: session.workspace.name,
            slug: session.workspace.slug,
            plan: session.workspace.plan,
          }
        : null,
      role: session.role,
      session: {
        id: session.session.id,
        expiresAt: session.session.expiresAt.toISOString(),
      },
    },
  });
}
