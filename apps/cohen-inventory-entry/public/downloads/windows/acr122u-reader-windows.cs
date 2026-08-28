using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class CohensAcr122uReader
{
    private const uint ScardScopeSystem = 2;
    private const uint ScardShareShared = 2;
    private const uint ScardProtocolT0 = 1;
    private const uint ScardProtocolT1 = 2;
    private const uint ScardLeaveCard = 0;
    private const int ScardSuccess = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct ScardIoRequest
    {
        public uint Protocol;
        public uint Size;
    }

    [DllImport("winscard.dll")]
    private static extern int SCardEstablishContext(
        uint scope,
        IntPtr reservedOne,
        IntPtr reservedTwo,
        out IntPtr context);

    [DllImport("winscard.dll")]
    private static extern int SCardReleaseContext(IntPtr context);

    [DllImport("winscard.dll", EntryPoint = "SCardListReadersW", CharSet = CharSet.Unicode)]
    private static extern int SCardListReaders(
        IntPtr context,
        string groups,
        IntPtr readers,
        ref uint readerCharacters);

    [DllImport("winscard.dll", EntryPoint = "SCardConnectW", CharSet = CharSet.Unicode)]
    private static extern int SCardConnect(
        IntPtr context,
        string reader,
        uint shareMode,
        uint preferredProtocols,
        out IntPtr card,
        out uint activeProtocol);

    [DllImport("winscard.dll")]
    private static extern int SCardDisconnect(IntPtr card, uint disposition);

    [DllImport("winscard.dll")]
    private static extern int SCardTransmit(
        IntPtr card,
        ref ScardIoRequest sendPci,
        byte[] sendBuffer,
        int sendLength,
        IntPtr receivePci,
        [Out] byte[] receiveBuffer,
        ref int receiveLength);

    private static string EscapeJson(string value)
    {
        if (value == null) return "";
        StringBuilder output = new StringBuilder();
        foreach (char character in value)
        {
            switch (character)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\n': output.Append("\\n"); break;
                case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if (character < 0x20) output.Append("\\u" + ((int)character).ToString("x4"));
                    else output.Append(character);
                    break;
            }
        }
        return output.ToString();
    }

    private static void WriteReader(string status, string reader)
    {
        string readerJson = reader == null ? "" : ",\"reader\":\"" + EscapeJson(reader) + "\"";
        Console.WriteLine("{\"type\":\"reader\",\"status\":\"" + status + "\"" + readerJson + "}");
    }

    private static void WriteError(string message, int code)
    {
        Console.WriteLine("{\"type\":\"error\",\"message\":\"" + EscapeJson(message) +
            "\",\"code\":\"0x" + unchecked((uint)code).ToString("X8") + "\"}");
    }

    private static string[] ListReaders(IntPtr context)
    {
        uint characters = 0;
        int result = SCardListReaders(context, null, IntPtr.Zero, ref characters);
        if (result != ScardSuccess || characters <= 1) return new string[0];

        IntPtr buffer = Marshal.AllocHGlobal(checked((int)characters * 2));
        try
        {
            result = SCardListReaders(context, null, buffer, ref characters);
            if (result != ScardSuccess) return new string[0];
            string readerList = Marshal.PtrToStringUni(buffer, checked((int)characters));
            return (readerList ?? "").Split(new[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string SelectReader(string[] readers)
    {
        foreach (string reader in readers)
        {
            if (reader.IndexOf("ACR122", StringComparison.OrdinalIgnoreCase) >= 0) return reader;
        }
        return null;
    }

    private static bool ReaderStillExists(IntPtr context, string expectedReader)
    {
        foreach (string reader in ListReaders(context))
        {
            if (String.Equals(reader, expectedReader, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static void ReadUid(IntPtr card, uint protocol)
    {
        byte[] command = { 0xFF, 0xCA, 0x00, 0x00, 0x00 };
        byte[] response = new byte[258];
        int responseLength = response.Length;
        ScardIoRequest pci = new ScardIoRequest
        {
            Protocol = protocol,
            Size = (uint)Marshal.SizeOf(typeof(ScardIoRequest))
        };
        int result = SCardTransmit(
            card,
            ref pci,
            command,
            command.Length,
            IntPtr.Zero,
            response,
            ref responseLength);

        if (result != ScardSuccess)
        {
            WriteError("La tarjeta fue detectada, pero no devolvió su UID.", result);
            return;
        }
        if (responseLength < 3 || response[responseLength - 2] != 0x90 || response[responseLength - 1] != 0x00)
        {
            WriteError("La tarjeta no admite la lectura estándar de UID.", unchecked((int)0x8010000F));
            return;
        }

        StringBuilder uid = new StringBuilder();
        for (int index = 0; index < responseLength - 2; index++) uid.Append(response[index].ToString("X2"));
        Console.WriteLine("{\"type\":\"card\",\"uid\":\"" + uid + "\"}");
    }

    public static void Main()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        while (true)
        {
            IntPtr context;
            int result = SCardEstablishContext(ScardScopeSystem, IntPtr.Zero, IntPtr.Zero, out context);
            if (result != ScardSuccess)
            {
                WriteError("No se pudo iniciar el servicio de tarjetas inteligentes de Windows.", result);
                Thread.Sleep(2000);
                continue;
            }

            try
            {
                string[] readers = ListReaders(context);
                string reader = SelectReader(readers);
                if (reader == null)
                {
                    WriteReader("missing", null);
                    Thread.Sleep(2000);
                    continue;
                }

                WriteReader("connected", reader);
                bool cardPresent = false;
                int failedConnections = 0;
                while (true)
                {
                    IntPtr card;
                    uint protocol;
                    result = SCardConnect(
                        context,
                        reader,
                        ScardShareShared,
                        ScardProtocolT0 | ScardProtocolT1,
                        out card,
                        out protocol);

                    if (result == ScardSuccess)
                    {
                        failedConnections = 0;
                        if (!cardPresent) ReadUid(card, protocol);
                        cardPresent = true;
                        SCardDisconnect(card, ScardLeaveCard);
                    }
                    else
                    {
                        if (cardPresent) Console.WriteLine("{\"type\":\"card\",\"status\":\"removed\"}");
                        cardPresent = false;
                        failedConnections += 1;
                        if (failedConnections >= 8)
                        {
                            failedConnections = 0;
                            if (!ReaderStillExists(context, reader))
                            {
                                WriteReader("missing", reader);
                                break;
                            }
                        }
                    }
                    Thread.Sleep(250);
                }
            }
            finally
            {
                SCardReleaseContext(context);
            }
            Thread.Sleep(1000);
        }
    }
}
