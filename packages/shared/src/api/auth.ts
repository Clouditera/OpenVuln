export interface AuthUserDto {
  id: number;
  login: string;
  avatar_url: string | null;
}

export interface MeResponse {
  authenticated: boolean;
  user: AuthUserDto | null;
}

export interface OwnerDiscloseBody {
  finding_ids: string[];
}

export interface OwnerDiscloseResponse {
  disclosed_count: number;
}
