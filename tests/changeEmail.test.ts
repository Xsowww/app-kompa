import { beforeEach, describe, expect, it, vi } from 'vitest';

// Réglages › Compte › « Changer d’adresse » (store/auth › changeEmail), Supabase replaced by a fake client.
const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) };
Object.assign(globalThis, { location: new URL('https://kompaly.test/profil'), localStorage: storage, sessionStorage: storage });

const updateUser = vi.fn();
let passwordOk = true;
vi.mock('../src/lib/supabase', async original => ({
  ...(await original<typeof import('../src/lib/supabase')>()),
  supabase: { auth: { updateUser } },
  checkPassword: async () => passwordOk,
}));
const { useAuth, AUTH_MSG } = await import('../src/store/auth');

const lea = { id: 'u1', name: 'Léa', email: 'lea@exemple.fr', createdAt: '2026-10-01T00:00:00Z' };

beforeEach(() => {
  updateUser.mockReset();
  passwordOk = true;
  useAuth.setState({ user: { ...lea } });
});

describe('changing the account’s e-mail address', () => {
  it('asks Supabase to send its links, back to Réglages › Compte, and shows the address waiting', async () => {
    updateUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'lea@exemple.fr', new_email: 'lea.nouvelle@exemple.fr', created_at: lea.createdAt, user_metadata: { name: 'Léa' }, app_metadata: {} } }, error: null });
    await useAuth.getState().changeEmail(' Lea.Nouvelle@exemple.fr ', 'secret');
    expect(updateUser).toHaveBeenCalledWith({ email: 'lea.nouvelle@exemple.fr' }, { emailRedirectTo: 'https://kompaly.test/profil?onglet=compte' });
    expect(useAuth.getState().user).toMatchObject({ email: 'lea@exemple.fr', pendingEmail: 'lea.nouvelle@exemple.fr' });
  });

  it('refuses the same address, a malformed one and a wrong password before asking Supabase', async () => {
    await expect(useAuth.getState().changeEmail('LEA@exemple.fr', 'secret')).rejects.toThrow('C’est déjà l’adresse de ton compte.');
    await expect(useAuth.getState().changeEmail('lea@', 'secret')).rejects.toThrow('Cette adresse e-mail n’est pas valide.');
    passwordOk = false;
    await expect(useAuth.getState().changeEmail('autre@exemple.fr', 'faux')).rejects.toThrow(AUTH_MSG.wrongPassword);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('says it when the address already has an account', async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } });
    await expect(useAuth.getState().changeEmail('pris@exemple.fr', 'secret')).rejects.toThrow(AUTH_MSG.accountExists);
  });
});
