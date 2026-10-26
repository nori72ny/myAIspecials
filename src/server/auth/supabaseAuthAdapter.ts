export class SupabaseServerAuthAdapter {
  private readonly supabaseUrl = process.env.SUPABASE_URL || "";
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  private readonly ownerAllowlist = new Set((process.env.OWNER_UUID_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean));
  public async validateUserToken(accessToken: string) {
    if (!accessToken || accessToken.length < 10) return { isAuthenticated: false, isOwner: false };
    try {
      const res = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${accessToken}`, apikey: this.serviceRoleKey }
      });
      if (!res.ok) return { isAuthenticated: false, isOwner: false };
      const user = await res.json();
      return { isAuthenticated: true, isOwner: this.ownerAllowlist.has(user?.id), userId: user?.id };
    } catch {
      return { isAuthenticated: false, isOwner: false };
    }
  }
}
