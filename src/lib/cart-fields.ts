import type { ApiCart } from "@/lib/cart-types";

export const checkoutLabels: Record<string, string> = {
  "user-name": "Ім’я", "user-phone": "Телефон", "user-email": "Email", "recipient-name": "Ім’я отримувача", "recipient-phone": "Телефон отримувача",
  "delivery-type": "Спосіб доставки", "payment-type": "Спосіб оплати", payment_systems_id: "Платіжна система", saved_address_id: "Збережена адреса",
  "floor-checkbox": "Доставка на поверх", elevator: "Ліфт", date: "Дата доставки", comment: "Коментар",
  "stock": "ID складу", "delivery-city_agromat-stock": "Склад самовивозу", "delivery-city_np-city-name": "Місто Нової пошти", "delivery-city_np-city": "Код міста Нової пошти",
  "delivery-city_np-department-name": "Відділення Нової пошти", "delivery-city_np-department": "Код відділення Нової пошти",
  "delivery-city_np-postomat-city-name": "Місто поштомата", "delivery-city_np-postomat-city": "Код міста поштомата",
  "delivery-city_np-courier-name": "Місто кур’єрської доставки", "delivery-city_np-courier": "Код міста кур’єрської доставки",
  "delivery-city_agromat-kyiv_city": "Місто доставки AGROMAT", "delivery-city_agromat-kyiv_street": "Вулиця доставки AGROMAT",
};
const deliveryLabels: Record<string, string> = { npDepartment: "Нова пошта · відділення", npCourier: "Нова пошта · кур’єр", agrWarehouse: "Самовивіз AGROMAT", agrCity: "Доставка AGROMAT · місто", agrUkraine: "Доставка AGROMAT · Україна" };
const paymentLabels: Record<string, string> = {cash: "Готівка", bank: "Безготівкова оплата", online: "Онлайн-оплата", online_full: "Онлайн · повна оплата", online_parts: "Оплата частинами"};
export const fieldValue = (key: string, value: string | number | boolean, cart?: ApiCart) => key === "payment-type" ? paymentLabels[String(value)] || String(value) : key === "delivery-city_agromat-stock" ? cart?.delivery_point?.name ? `${cart.delivery_point.name} · код форми ${value}` : `Код складу у формі: ${value} · назва не передана API` : key === "delivery-type" ? deliveryLabels[String(value)] || String(value) : typeof value === "boolean" ? value ? "Так" : "Ні" : String(value);
