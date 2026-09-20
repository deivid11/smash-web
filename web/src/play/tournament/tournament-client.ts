/** Browser side of lib/net/tournament-protocol.ts. Rides on the account session
 * (bearer token) — LAN tournaments need an account because entrants are accounts.
 */
import type { AccountClient } from '../../account/account-client.ts';
import type { PublicProfile } from '../../../../lib/net/account-protocol.ts';
import {
  TOURNAMENTS_API, type CheckinBody, type CreateTournamentBody, type TournamentListResponse, type TournamentResponse, type TournamentView, type UserSearchResponse,
} from '../../../../lib/net/tournament-protocol.ts';

export class TournamentClient {
  constructor(private readonly account: AccountClient) {}
  async list(): Promise<TournamentListResponse> { return this.account.request<TournamentListResponse>('GET', TOURNAMENTS_API); }
  async create(body: CreateTournamentBody): Promise<TournamentView> { return (await this.account.request<TournamentResponse>('POST', TOURNAMENTS_API, body)).tournament; }
  async get(id: string): Promise<TournamentView> { return (await this.account.request<TournamentResponse>('GET', `${TOURNAMENTS_API}/${encodeURIComponent(id)}`)).tournament; }
  async searchUsers(query: string): Promise<PublicProfile[]> { return (await this.account.request<UserSearchResponse>('GET', `${TOURNAMENTS_API}/users?q=${encodeURIComponent(query)}`)).users; }
  async checkin(id: string, matchId: number, body: CheckinBody): Promise<TournamentView> { return (await this.account.request<TournamentResponse>('POST', `${TOURNAMENTS_API}/${encodeURIComponent(id)}/sets/${matchId}/checkin`, body)).tournament; }
  async report(id: string, matchId: number, winner: number): Promise<TournamentView> { return (await this.account.request<TournamentResponse>('POST', `${TOURNAMENTS_API}/${encodeURIComponent(id)}/sets/${matchId}/result`, { winner })).tournament; }
  async reopen(id: string, matchId: number): Promise<TournamentView> { return (await this.account.request<TournamentResponse>('POST', `${TOURNAMENTS_API}/${encodeURIComponent(id)}/sets/${matchId}/reopen`, {})).tournament; }
  async cancel(id: string): Promise<TournamentView> { return (await this.account.request<TournamentResponse>('POST', `${TOURNAMENTS_API}/${encodeURIComponent(id)}/cancel`, {})).tournament; }
  async remove(id: string): Promise<void> { await this.account.request('DELETE', `${TOURNAMENTS_API}/${encodeURIComponent(id)}`); }
}
