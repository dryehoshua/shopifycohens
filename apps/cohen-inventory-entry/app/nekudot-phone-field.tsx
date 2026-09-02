import { useState } from "react";

const PHONE_COUNTRIES = [
  ["+52", "México (+52)"],
  ["+1", "Estados Unidos / Canadá (+1)"],
  ["+972", "Israel (+972)"],
  ["+34", "España (+34)"],
  ["+54", "Argentina (+54)"],
  ["+55", "Brasil (+55)"],
  ["+56", "Chile (+56)"],
  ["+57", "Colombia (+57)"],
  ["+51", "Perú (+51)"],
  ["+507", "Panamá (+507)"],
  ["+506", "Costa Rica (+506)"],
  ["+502", "Guatemala (+502)"],
  ["+598", "Uruguay (+598)"],
  ["+44", "Reino Unido (+44)"],
  ["+33", "Francia (+33)"],
  ["+41", "Suiza (+41)"],
] as const;

export function NekudotPhoneField({
  label = "Teléfono móvil",
  defaultPhone = "",
  full = false,
}: {
  label?: string;
  defaultPhone?: string;
  full?: boolean;
}) {
  const [countryCode, setCountryCode] = useState("+52");

  return <fieldset className={`nk-phone-field${full ? " full" : ""}`}>
    <legend>{label}</legend>
    <div className="nk-phone-controls">
      <label>
        <span>País</span>
        <select name="countryCode" value={countryCode} onChange={(event) => setCountryCode(event.currentTarget.value)}>
          {PHONE_COUNTRIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          <option value="other">Otro país</option>
        </select>
      </label>
      {countryCode === "other" ? <label className="nk-country-custom">
        <span>Lada</span>
        <input name="customCountryCode" required inputMode="tel" pattern="\+[1-9][0-9]{0,3}" placeholder="+___" aria-label="Lada internacional" />
      </label> : null}
      <label className="nk-phone-number">
        <span>Número</span>
        <input name="phone" required inputMode="tel" autoComplete="tel-national" placeholder={countryCode === "+52" ? "55 1234 5678" : "Número local"} defaultValue={defaultPhone} />
      </label>
    </div>
    <small>México está seleccionado por defecto. Para otro país, elige su lada.</small>
  </fieldset>;
}
