import "./globals.css";
import NavigationLoading from "./ui/NavigationLoading";
import localFont from "next/font/local";
const onest = localFont({
  src: "./fonts/onest.woff2",
  display: "swap",
  variable: "--font-sans",
});
export const metadata = {
  title: "Thesauros Developers · Build your Earn experience",
  description:
    "Prototype customer journeys, explore the sandbox API and prepare your Thesauros integration.",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en" className={onest.variable}>
      <body>
        {children}
        <NavigationLoading />
      </body>
    </html>
  );
}
