#include <PCSC/wintypes.h>
#include <PCSC/winscard.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static volatile sig_atomic_t keep_running = 1;

static void stop_reader(int signal_number) {
  (void)signal_number;
  keep_running = 0;
}

static void print_json_string(const char *value) {
  putchar('"');
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor += 1) {
    switch (*cursor) {
      case '"': fputs("\\\"", stdout); break;
      case '\\': fputs("\\\\", stdout); break;
      case '\n': fputs("\\n", stdout); break;
      case '\r': fputs("\\r", stdout); break;
      case '\t': fputs("\\t", stdout); break;
      default:
        if (*cursor < 0x20) fprintf(stdout, "\\u%04x", *cursor);
        else putchar(*cursor);
    }
  }
  putchar('"');
}

static void print_reader_status(const char *status, const char *reader) {
  fputs("{\"type\":\"reader\",\"status\":", stdout);
  print_json_string(status);
  if (reader) {
    fputs(",\"reader\":", stdout);
    print_json_string(reader);
  }
  fputs("}\n", stdout);
  fflush(stdout);
}

static void print_error(const char *message, LONG code) {
  fputs("{\"type\":\"error\",\"message\":", stdout);
  print_json_string(message);
  fprintf(stdout, ",\"code\":\"0x%08lX\"}\n", (unsigned long)code);
  fflush(stdout);
}

static void print_card(const BYTE *uid, DWORD uid_length, const BYTE *atr, DWORD atr_length) {
  fputs("{\"type\":\"card\",\"uid\":\"", stdout);
  for (DWORD index = 0; index < uid_length; index += 1) fprintf(stdout, "%02X", uid[index]);
  fputs("\",\"atr\":\"", stdout);
  for (DWORD index = 0; index < atr_length; index += 1) fprintf(stdout, "%02X", atr[index]);
  fputs("\"}\n", stdout);
  fflush(stdout);
}

static int read_uid(SCARDCONTEXT context, const char *reader) {
  SCARDHANDLE card = 0;
  DWORD protocol = 0;
  LONG result = SCardConnect(
    context,
    reader,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
    &card,
    &protocol
  );
  if (result != SCARD_S_SUCCESS) {
    print_error("No se pudo abrir la tarjeta NFC.", result);
    return 0;
  }

  BYTE atr[64];
  DWORD atr_length = sizeof(atr);
  DWORD state = 0;
  DWORD reader_name_length = 0;
  result = SCardStatus(card, NULL, &reader_name_length, &state, &protocol, atr, &atr_length);
  if (result != SCARD_S_SUCCESS) {
    atr_length = 0;
  }

  const BYTE command[] = {0xFF, 0xCA, 0x00, 0x00, 0x00};
  BYTE response[258];
  DWORD response_length = sizeof(response);
  SCARD_IO_REQUEST send_pci = { protocol, sizeof(SCARD_IO_REQUEST) };
  result = SCardTransmit(
    card,
    &send_pci,
    command,
    sizeof(command),
    NULL,
    response,
    &response_length
  );
  SCardDisconnect(card, SCARD_LEAVE_CARD);

  if (result != SCARD_S_SUCCESS) {
    print_error("La tarjeta fue detectada, pero no devolvió su UID.", result);
    return 0;
  }
  if (response_length < 3 || response[response_length - 2] != 0x90 || response[response_length - 1] != 0x00) {
    print_error("La tarjeta no admite la lectura estándar de UID.", SCARD_E_PROTO_MISMATCH);
    return 0;
  }

  print_card(response, response_length - 2, atr, atr_length);
  return 1;
}

int main(void) {
  signal(SIGINT, stop_reader);
  signal(SIGTERM, stop_reader);
  setvbuf(stdout, NULL, _IOLBF, 0);

  while (keep_running) {
    SCARDCONTEXT context = 0;
    LONG result = SCardEstablishContext(SCARD_SCOPE_SYSTEM, NULL, NULL, &context);
    if (result != SCARD_S_SUCCESS) {
      print_error("No se pudo iniciar el servicio PC/SC.", result);
      sleep(2);
      continue;
    }

    DWORD readers_length = 0;
    result = SCardListReaders(context, NULL, NULL, &readers_length);
    char *readers = result == SCARD_S_SUCCESS && readers_length > 1
      ? calloc(readers_length, sizeof(char))
      : NULL;
    if (readers) result = SCardListReaders(context, NULL, readers, &readers_length);
    if (result != SCARD_S_SUCCESS || !readers || !readers[0]) {
      print_reader_status("missing", NULL);
      free(readers);
      SCardReleaseContext(context);
      sleep(2);
      continue;
    }

    char *reader = readers;
    for (char *candidate = readers; *candidate; candidate += strlen(candidate) + 1) {
      if (strstr(candidate, "ACR122U")) {
        reader = candidate;
        break;
      }
    }
    print_reader_status("connected", reader);
    SCARD_READERSTATE reader_state;
    memset(&reader_state, 0, sizeof(reader_state));
    reader_state.szReader = reader;
    reader_state.dwCurrentState = SCARD_STATE_UNAWARE;
    int card_present = 0;

    while (keep_running) {
      result = SCardGetStatusChange(context, 750, &reader_state, 1);
      if ((DWORD)result == SCARD_E_TIMEOUT) continue;
      if (result != SCARD_S_SUCCESS) {
        print_error("Se perdió la conexión con el lector.", result);
        break;
      }

      DWORD event_state = reader_state.dwEventState;
      if (event_state & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE)) {
        print_reader_status("missing", reader);
        break;
      }

      int now_present = (event_state & SCARD_STATE_PRESENT) != 0;
      if (now_present && !card_present) {
        read_uid(context, reader);
      } else if (!now_present && card_present) {
        fputs("{\"type\":\"card\",\"status\":\"removed\"}\n", stdout);
        fflush(stdout);
      }
      card_present = now_present;
      reader_state.dwCurrentState = event_state & ~SCARD_STATE_CHANGED;
    }

    free(readers);
    SCardReleaseContext(context);
    if (keep_running) sleep(1);
  }
  return 0;
}
