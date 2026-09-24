"""Che cosa il caricamento tocca e che cosa lascia stare.

La configurazione che vive sta in Mongo: i file sono il seme. Queste due
funzioni decidono che cosa sopravvive a un riavvio, quindi sono la parte da
coprire — il resto dello script è I/O.

    uv run pytest
"""

from scripts.load_configuration import add_missing, merge


def test_aggiunge_solo_quello_che_manca():
    stored = {"prevalidation": {"reject_threshold": 0.8}}
    seed = {"prevalidation": {"reject_threshold": 0.6, "max_underspecified_attempts": 100}}

    documento, aggiunti = add_missing(stored, seed)

    # Il valore che gira resta quello che gira, non quello del file.
    assert documento["prevalidation"]["reject_threshold"] == 0.8
    # Il campo nuovo entra da solo: uno sviluppo che lo introduce non richiede
    # interventi a mano perché il sottosistema riparta.
    assert documento["prevalidation"]["max_underspecified_attempts"] == 100
    assert aggiunti == ["prevalidation.max_underspecified_attempts"]


def test_un_campo_che_c_e_non_si_tocca_mai():
    stored = {"limits": {"zero": 0, "falso": False, "nullo": None, "vuoto": ""}}
    seed = {"limits": {"zero": 99, "falso": True, "nullo": "qualcosa", "vuoto": "testo"}}

    documento, aggiunti = add_missing(stored, seed)

    # `0`, `false`, `null` e la stringa vuota sono valori, non assenze: chi
    # guardasse la verità del valore invece della presenza della chiave li
    # sovrascriverebbe tutti.
    assert documento["limits"] == {"zero": 0, "falso": False, "nullo": None, "vuoto": ""}
    assert aggiunti == []


def test_scende_solo_dove_sono_tutti_e_due_oggetti():
    # In Mongo il ramo è diventato qualcos'altro: è una scelta di chi l'ha
    # cambiato, e non la si ribalta aprendo il ramo del file.
    stored = {"ai": "spento"}
    seed = {"ai": {"provider": "anthropic", "timeout_ms": 20000}}

    documento, aggiunti = add_missing(stored, seed)

    assert documento["ai"] == "spento"
    assert aggiunti == []


def test_percorsi_annidati_riportati_per_intero():
    stored = {"ai": {"provider": "anthropic", "providers": {"anthropic": {"model": "haiku"}}}}
    seed = {
        "ai": {
            "provider": "anthropic",
            "timeout_ms": 20000,
            "providers": {"anthropic": {"model": "haiku", "max_tokens": 512}},
        }
    }

    documento, aggiunti = add_missing(stored, seed)

    assert documento["ai"]["timeout_ms"] == 20000
    assert documento["ai"]["providers"]["anthropic"] == {"model": "haiku", "max_tokens": 512}
    assert sorted(aggiunti) == ["ai.providers.anthropic.max_tokens", "ai.timeout_ms"]


def test_un_documento_senza_niente_da_aggiungere_resta_identico():
    stored = {"subsystem": "sso", "listen": {"host": "127.0.0.1", "port": 9300}}

    documento, aggiunti = add_missing(stored, {"listen": {"host": "0.0.0.0", "port": 1}})

    assert documento == stored
    assert aggiunti == []


def test_il_segreto_sostituisce_sempre():
    # Una chiave ruotata deve valere: il file dei segreti è l'unico posto dove
    # qualcuno la scrive, e nessuno la cambia dal sistema.
    stored = {"ai": {"providers": {"anthropic": {"model": "haiku", "api_key": "vecchia"}}}}
    segreto = {"ai": {"providers": {"anthropic": {"api_key": "nuova"}}}}

    documento = merge(stored, segreto)

    assert documento["ai"]["providers"]["anthropic"]["api_key"] == "nuova"
    # E non si porta via i rami vicini.
    assert documento["ai"]["providers"]["anthropic"]["model"] == "haiku"
