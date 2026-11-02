import torch

def _window(L, K, d):
    """NATTEN 0.15 get_window_start / get_pb_start 를 그대로 옮긴 인덱스표 → (neighbor[L,K], pb[L,K])"""
    NS = K // 2
    nb = torch.empty(L, K, dtype=torch.long); pbt = torch.empty(L, K, dtype=torch.long)
    for i in range(L):
        ni = i - NS * d
        if d <= 1:
            ni = max(ni, 0) + (1 if i + NS >= L else 0) * (L - i - NS - 1)
        else:
            if ni < 0:
                ni = i % d
            elif i + NS * d >= L:
                imodd = i % d; a = (L // d) * d; b = L - a
                ni = (L - b + imodd - 2 * NS * d) if imodd < b else (L - a + imodd - K * d)
        pb = NS
        if d <= 1:
            if i < NS: pb += NS - i
            if i + NS >= L: pb += L - NS - 1 - i
        else:
            if i - NS * d < 0: pb += NS - i // d
            elif i + NS * d >= L: pb += (L - i - 1) // d - NS
        for j in range(K):
            nb[i, j] = ni + j * d; pbt[i, j] = pb + j
    return nb, pbt

_cache = {}
def _tab(L, K, d, dev):
    key = (L, K, d, str(dev))
    if key not in _cache:
        nb, pb = _window(L, K, d); _cache[key] = (nb.to(dev), pb.to(dev))
    return _cache[key]

def natten1dqkrpb(q, k, rpb, kernel_size, dilation):          # q,k [B,H,L,D]  rpb [H,2K-1]  → [B,H,L,K]
    L = q.shape[2]; nb, pb = _tab(L, kernel_size, dilation, q.device)
    kg = k[:, :, nb, :]                                       # [B,H,L,K,D]
    return torch.einsum('bhid,bhikd->bhik', q, kg) + rpb[:, pb].unsqueeze(0)

def natten1dav(attn, v, kernel_size, dilation):               # attn [B,H,L,K]  v [B,H,L,D]
    L = v.shape[2]; nb, _ = _tab(L, kernel_size, dilation, v.device)
    return torch.einsum('bhik,bhikd->bhid', attn, v[:, :, nb, :])

def natten2dqkrpb(q, k, rpb, kernel_size, dilation):          # q,k [B,H,Ht,Wd,D]  rpb [H,2K-1,2K-1]  → [B,H,Ht,Wd,K*K]
    Ht, Wd = q.shape[2], q.shape[3]
    nh, ph = _tab(Ht, kernel_size, dilation, q.device); nw, pw = _tab(Wd, kernel_size, dilation, q.device)
    kg = k[:, :, nh][:, :, :, :, nw]                          # [B,H,Ht,Kh,Wd,Kw,D]
    attn = torch.einsum('bhijd,bhiajcd->bhijac', q, kg)
    bias = rpb[:, ph[:, :, None, None], pw[None, None, :, :]]   # [H,Ht,Kh,Wd,Kw]
    attn = attn + bias.permute(0, 1, 3, 2, 4).unsqueeze(0)
    return attn.reshape(*attn.shape[:4], kernel_size * kernel_size)

def natten2dav(attn, v, kernel_size, dilation):               # attn [B,H,Ht,Wd,K*K]  v [B,H,Ht,Wd,D]
    Ht, Wd = v.shape[2], v.shape[3]
    nh, _ = _tab(Ht, kernel_size, dilation, v.device); nw, _ = _tab(Wd, kernel_size, dilation, v.device)
    vg = v[:, :, nh][:, :, :, :, nw]
    a = attn.reshape(*attn.shape[:4], kernel_size, kernel_size)
    return torch.einsum('bhijac,bhiajcd->bhijd', a, vg)
