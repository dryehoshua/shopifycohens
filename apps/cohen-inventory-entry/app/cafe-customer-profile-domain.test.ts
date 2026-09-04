import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCafeCustomerPhone,
  normalizeCafeCustomerProfile,
} from "./cafe-customer-profile-domain.ts";

test("normaliza teléfono mexicano y perfil completo de entrega", () => {
  assert.equal(normalizeCafeCustomerPhone("55 1234 5678"), "+525512345678");
  assert.deepEqual(normalizeCafeCustomerProfile({
    firstName: "  Miriam ",
    lastName: " Cohen  ",
    email: "MIRIAM@EXAMPLE.COM",
    phone: "55 1234 5678",
    address1: "Av. Jesús del Monte 39",
    address2: "Torre A, depto. 4",
    city: "Huixquilucan",
    province: "MEX",
    zip: "52764",
    community: "Maguen David",
    cardTier: "blue",
    blueAffiliationCode: " ib victoria ",
    deliveryInstructions: "Entregar en recepción",
  }), {
    customerId: null,
    firstName: "Miriam",
    lastName: "Cohen",
    email: "miriam@example.com",
    phone: "+525512345678",
    address: {
      id: null,
      address1: "Av. Jesús del Monte 39",
      address2: "Torre A, depto. 4",
      city: "Huixquilucan",
      province: "MEX",
      zip: "52764",
      countryCode: "MX",
      phone: "+525512345678",
    },
    community: "Maguen David",
    cardTier: "BLUE",
    blueAffiliationCode: "IB-VICTORIA",
    deliveryInstructions: "Entregar en recepción",
  });
});

test("permite un cliente sin dirección ni membresía", () => {
  assert.deepEqual(normalizeCafeCustomerProfile({ firstName: "Sara" }), {
    customerId: null,
    firstName: "Sara",
    lastName: "",
    email: null,
    phone: null,
    address: null,
    community: null,
    cardTier: null,
    blueAffiliationCode: null,
    deliveryInstructions: null,
  });
});

test("rechaza correo, teléfono y dirección incompletos", () => {
  assert.throws(() => normalizeCafeCustomerProfile({ firstName: "A" }), /nombre/);
  assert.throws(() => normalizeCafeCustomerProfile({ firstName: "Sara", email: "sara@" }), /correo/);
  assert.throws(() => normalizeCafeCustomerProfile({ firstName: "Sara", phone: "123" }), /teléfono/);
  assert.throws(() => normalizeCafeCustomerProfile({ firstName: "Sara", city: "México" }), /calle y número/);
});
