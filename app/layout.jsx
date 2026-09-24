import "./globals.css";
import NavigationLoading from "./ui/NavigationLoading";
import localFont from "next/font/local";
const onest = localFont({
  src: "./fonts/onest.woff2",
  display: "swap",
  variable: "--font-sans",
});
export const metadata = {
  title: "Thesauros · Account",
  description:
    "View vault balances, compare lending markets and follow onchain activity with Thesauros.",
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
