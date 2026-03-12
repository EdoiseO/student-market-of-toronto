import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function RegisterForm({
  className,
  ...props
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            Fill in your details below to sign up
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="firstName">First Name</FieldLabel>
                <Input id="firstName" type="text" placeholder="John" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="lastName">Last Name</FieldLabel>
                <Input id="lastName" type="text" placeholder="Doe" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">School Email (enter your Toronto school email)</FieldLabel>
                <Input id="email" type="email" placeholder="john.doe@university.ca" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" type="password" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
                <Input id="confirmPassword" type="password" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="school">School / Campus</FieldLabel>
                <Input id="school" type="text" placeholder="e.g. University of Toronto" required />
              </Field>
              <Field>
                <Button type="submit">Sign Up</Button>
                <FieldDescription className="text-center">
                  Already have an account? <a href="#">Login</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
