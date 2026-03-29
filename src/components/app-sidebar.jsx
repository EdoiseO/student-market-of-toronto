"use client"

import { NavUser } from "@/components/nav-user"
import { SearchSidebarFilters } from "@/components/search-sidebar-filters";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CATEGORIES } from "@/lib/categories";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  ChevronRightIcon,
  FolderIcon,
  LayoutGridIcon,
  LayoutDashboardIcon,
  ListIcon,
  MessageSquareIcon,
  PlusSquareIcon,
  StarIcon,
  TerminalIcon,
  UserIcon,
  FileTextIcon,
} from "lucide-react"

const navigationItems = [
  {
    title: "Browse Listings",
    url: "/",
    icon: LayoutGridIcon,
  },
];

const sellingItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboardIcon,
  },
  {
    title: "Create Listing",
    url: "/listings/create",
    icon: PlusSquareIcon,
  },
  {
    title: "My Listings",
    url: "/dashboard?tab=all",
    icon: ListIcon,
  },
  {
    title: "Drafts",
    url: "/dashboard?tab=draft",
    icon: FileTextIcon,
  },
];

const buyingItems = [
  {
    title: "Favourites",
    url: "/dashboard?tab=favourite",
    icon: StarIcon,
  },
  {
    title: "Messages",
    url: "#",
    icon: MessageSquareIcon,
  },
];

const accountItems = [
  {
    title: "Profile",
    url: "#",
    icon: UserIcon,
  },
];

export function AppSidebar({
  user,
  ...props
}) {
  const pathname = usePathname();
  const categoriesOpen = pathname?.startsWith("/categories/") ?? false;
  const showLoggedInSections = Boolean(user);

  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div
                  className="flex aspect-square size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
                  <TerminalIcon className="size-5" />
                </div>
                <div className="grid flex-1 text-left text-base leading-tight">
                  <span className="truncate font-semibold">Student Market</span>
                  <span className="truncate text-sm text-sidebar-foreground/70">Toronto</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SearchSidebarFilters />
        <SidebarGroup>
          <SidebarGroupLabel>Marketplace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    className="min-h-11 rounded-xl px-3 text-sm"
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <Collapsible asChild defaultOpen={categoriesOpen}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="lg"
                    tooltip="Categories"
                    className="rounded-xl px-3 text-sm"
                  >
                    <>
                      <FolderIcon />
                      <span>Categories</span>
                    </>
                  </SidebarMenuButton>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction className="data-[state=open]:rotate-90">
                      <ChevronRightIcon />
                      <span className="sr-only">Toggle categories</span>
                    </SidebarMenuAction>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {CATEGORIES.map((category) => (
                        <SidebarMenuSubItem key={category.slug}>
                          <SidebarMenuSubButton asChild>
                            <Link href={`/categories/${category.slug}`}>
                              <span>{category.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {showLoggedInSections ? (
          <SidebarGroup>
            <SidebarGroupLabel>Selling</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sellingItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className="min-h-11 rounded-xl px-3 text-sm"
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        {showLoggedInSections ? (
          <SidebarGroup>
            <SidebarGroupLabel>Buying</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {buyingItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className="min-h-11 rounded-xl px-3 text-sm"
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        {showLoggedInSections ? (
          <SidebarGroup>
            <SidebarGroupLabel>Account</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className="min-h-11 rounded-xl px-3 text-sm"
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <SignOutButton />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
